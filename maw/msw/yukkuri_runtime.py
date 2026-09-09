"""Optional, pinned Yukkuri resources. Never runs package installation scripts."""

from __future__ import annotations

import base64
import hashlib
import json
import platform
import shutil
import tarfile
import threading
import uuid
import zipfile
from pathlib import Path, PurePosixPath

import requests

from maw.gui_platform import asset_path

MAX_DOWNLOAD = 160 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
VOICES = ["f1", "f2", "m1", "m2", "dvd", "imd1", "jgr", "r1"]
DEFAULT_RECIPE = {"provider": "yukkuri", "model": "aquestalk1", "voice": "f1",
                  "language_type": "Auto", "speed": 100}


class ResourceCancelled(Exception):
    pass


def manifest():
    return json.loads(asset_path("maw/msw/yukkuri_resources.json").read_text(encoding="utf-8"))


def platform_key():
    system = {"Windows": "win32", "Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    arch = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    key = f"{system}-{arch}"
    if key not in manifest()["nodes"]:
        raise ValueError("油库里资源暂不支持当前系统／架构")
    return key


def node_relative(key):
    return "node/node.exe" if key.startswith("win32-") else "node/bin/node"


def validate_recipe(raw):
    if not isinstance(raw, dict):
        raise ValueError("油库里配置格式无效")
    value = {key: raw.get(key, default) for key, default in DEFAULT_RECIPE.items()}
    if value["provider"] != "yukkuri" or value["model"] != "aquestalk1" or value["voice"] not in VOICES:
        raise ValueError("不支持的油库里引擎或音色")
    if value["language_type"] not in {"Auto", "Chinese", "English"}:
        raise ValueError("油库里仅支持自动、中、英文读法")
    if type(value["speed"]) is not int or not 50 <= value["speed"] <= 300:
        raise ValueError("油库里语速须为 50–300 的整数")
    value.update({key: manifest()[key] for key in ("engine_version", "text_version")})
    value["resource_version"] = manifest()["version"]
    return value


def check_cancel(cancel):
    if cancel.is_set():
        raise ResourceCancelled()


def safe_member(name):
    path = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or path.is_absolute()
            or any(part and (part in {"..", "."} or part.endswith((".", " "))) for part in name.split("/"))):
        raise ValueError("资源包包含不安全的路径")
    return path


def extract_package(archive, target, cancel):
    """Extract regular npm package files only, with traversal and size bounds."""
    total = 0
    with tarfile.open(archive, "r:gz") as stream:
        for index, member in enumerate(stream):
            check_cancel(cancel)
            parts = safe_member(member.name).parts
            if not parts or parts[0] != "package" or index > 20000:
                raise ValueError("资源包目录结构无效")
            if member.isdir():
                continue
            if not member.isfile() or len(parts) < 2:
                raise ValueError("资源包包含不支持的链接或文件")
            total += member.size
            if total > MAX_EXPANDED:
                raise ValueError("资源解压体积超过限制")
            destination = target.joinpath(*parts[1:])
            destination.parent.mkdir(parents=True, exist_ok=True)
            with stream.extractfile(member) as source, destination.open("xb") as output:
                shutil.copyfileobj(source, output)


def extract_node(archive, target, key):
    """Only take the executable and its license from the official archive."""
    binary = "node.exe" if key.startswith("win32-") else "bin/node"
    wanted = {binary: node_relative(key), "LICENSE": "node/LICENSE"}
    found = set()
    stream = zipfile.ZipFile(archive) if key.startswith("win32-") else tarfile.open(archive, "r:*")
    with stream:
        members = stream.infolist() if isinstance(stream, zipfile.ZipFile) else stream.getmembers()
        for member in members:
            name = member.filename if isinstance(stream, zipfile.ZipFile) else member.name
            parts = safe_member(name).parts
            relative = "/".join(parts[1:])
            if relative not in wanted:
                continue
            size = member.file_size if isinstance(stream, zipfile.ZipFile) else member.size
            if size > MAX_EXPANDED or relative in found:
                raise ValueError("Node 资源格式无效")
            if isinstance(stream, tarfile.TarFile) and not member.isfile():
                raise ValueError("Node 资源不能是链接")
            source = stream.open(member) if isinstance(stream, zipfile.ZipFile) else stream.extractfile(member)
            destination = target / wanted[relative]
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source, destination.open("xb") as output:
                shutil.copyfileobj(source, output)
            found.add(relative)
    if found != set(wanted):
        raise ValueError("Node 资源缺少程序或许可")
    if not key.startswith("win32-"):
        (target / node_relative(key)).chmod(0o755)


def digest_spec(item):
    if "integrity" in item:
        algorithm, value = item["integrity"].split("-", 1)
        if algorithm != "sha512":
            raise ValueError("不支持的资源摘要")
        return algorithm, base64.b64decode(value).hex()
    return "sha256", item["sha256"]


def download(item, cache, cancel, session):
    algorithm, expected = digest_spec(item)
    target = cache / expected
    if target.is_file() and hashlib.new(algorithm, target.read_bytes()).hexdigest() == expected:
        return target
    pending = cache / f"{expected}.{uuid.uuid4().hex}.pending"
    digest, size = hashlib.new(algorithm), 0
    try:
        with session.get(item["url"], stream=True, timeout=(10, 15), allow_redirects=False) as response:
            if response.status_code != 200:
                raise ValueError(f"资源下载失败（HTTP {response.status_code}），可稍后重试或使用离线资源包")
            with pending.open("xb") as output:
                for chunk in response.iter_content(65536):
                    check_cancel(cancel)
                    size += len(chunk)
                    if size > MAX_DOWNLOAD:
                        raise ValueError("资源下载体积超过限制")
                    digest.update(chunk)
                    output.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("资源校验失败，未启用该资源")
        pending.replace(target)
        return target
    except requests.RequestException as error:
        raise ValueError("资源下载网络失败；请重试或使用离线资源包") from error
    finally:
        pending.unlink(missing_ok=True)  # Only the uniquely owned partial download.


def inventory(root):
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("资源目录不能含有符号链接")
        if path.is_file() and path.name != "msw-runtime.json":
            result[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def verify(root, cancel=None):
    root = Path(root).resolve()
    cancel = cancel or threading.Event()
    try:
        receipt = json.loads((root / "msw-runtime.json").read_text(encoding="utf-8"))
        spec = manifest()
        if receipt["version"] != spec["version"] or receipt["platform"] != platform_key():
            raise ValueError("资源版本或系统不匹配，请安装当前版本的资源包")
        files = receipt["files"]
        required = {node_relative(receipt["platform"]), "english/en_rules.mjs", "english/LICENSE",
                    "node_modules/aquestalk.js/voices/v86.wasm",
                    *[f"node_modules/aquestalk.js/voices/{voice}.zip" for voice in VOICES]}
        if not isinstance(files, dict) or not required.issubset(files) or len(files) > 20000:
            raise ValueError("资源清单不完整")
        for relative, expected in files.items():
            check_cancel(cancel)
            path = root.joinpath(*safe_member(relative).parts)
            if not path.resolve().is_relative_to(root) or path.is_symlink() or path.stat().st_size > MAX_EXPANDED:
                raise ValueError("资源路径或大小无效")
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError("资源文件已损坏或改变，请重新安装")
        return root / node_relative(receipt["platform"])
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("资源目录不完整；请选择解压后包含 msw-runtime.json 的目录") from error


def install(base, cancel, progress):
    spec, key = manifest(), platform_key()
    base = Path(base)
    cache = base / "downloads"
    cache.mkdir(parents=True, exist_ok=True)
    root = base / f"yukkuri-{spec['version']}-{key}-{uuid.uuid4().hex[:8]}"
    root.mkdir()
    items = [*spec["packages"], *spec["files"], spec["nodes"][key]]
    with requests.Session() as session:
        for index, item in enumerate(items):
            check_cancel(cancel)
            progress(f"下载与校验资源 {index + 1}/{len(items)}", index, len(items))
            archive = download(item, cache, cancel, session)
            if item in spec["packages"]:
                extract_package(archive, root / item["path"], cancel)
            elif item in spec["files"]:
                destination = root / item["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(archive, destination)
            else:
                extract_node(archive, root, key)
    check_cancel(cancel)
    (root / "sources.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    (root / "README.txt").write_text(
        "MSW optional Yukkuri resources\n\n"
        "Extract this directory, then choose Media > TTS > Yukkuri > Apply directory and check.\n"
        "Use the directory containing msw-runtime.json. No system Node/npm installation is needed.\n"
        "Resources are platform specific. Keep all files and licenses together.\n\n"
        "Speech synthesis uses AquesTalk, copyright AQUEST Corporation. Original voice ZIPs\n"
        "contain AqLicence.txt; these terms differ from the JavaScript wrapper's MIT license.\n"
        "See https://www.a-quest.com/licence.html and the accompanying license.\n"
        "Node's license is in node/LICENSE. Other dependency licenses remain in node_modules.\n"
        "English rules and MIT license: english/, https://github.com/Love-Kogasa/bakak2k\n"
        "Pinned versions, origins and download digests: sources.json.\n",
        encoding="utf-8", newline="\n")
    receipt = {"version": spec["version"], "platform": key, "files": inventory(root)}
    (root / "msw-runtime.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8", newline="\n")
    return root


class RuntimeController:
    def __init__(self, data_root):
        self.base = Path(data_root) / "yukkuri"
        self.settings_path = self.base / "settings.json"
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.thread = None
        self.state = {"state": "idle", "message": "尚未检测本机资源", "current": 0, "total": 0}
        self.settings = {"engine": "qwen", "recipe": validate_recipe({}), "runtime_path": ""}
        try:
            stored = json.loads(self.settings_path.read_text(encoding="utf-8"))
            self.settings.update(engine=stored["engine"] if stored["engine"] in {"qwen", "yukkuri"} else "qwen",
                                 recipe=validate_recipe(stored["recipe"]), runtime_path=str(stored["runtime_path"]))
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def payload(self):
        with self.lock:
            return {"recipe": dict(self.settings["recipe"]), "engine": self.settings["engine"],
                    "runtime_path": self.settings["runtime_path"], "voices": VOICES, **self.state}

    def save(self, *, engine=None, recipe=None, runtime_path=None):
        with self.lock:
            value = dict(self.settings)
            if engine is not None:
                if engine not in {"qwen", "yukkuri"}:
                    raise ValueError("不支持的 TTS 引擎")
                value["engine"] = engine
            if recipe is not None:
                value["recipe"] = validate_recipe(recipe)
            if runtime_path is not None:
                value["runtime_path"] = str(runtime_path)
            self.base.mkdir(parents=True, exist_ok=True)
            pending = self.base / f"settings-{uuid.uuid4().hex}.tmp"
            pending.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
            pending.replace(self.settings_path)
            self.settings = value

    def start(self, action, directory=""):
        if action not in {"install", "check", "cancel"}:
            raise ValueError("未知资源操作")
        with self.lock:
            if action == "cancel":
                self.cancel.set()
                return self.payload()
            if self.thread and self.thread.is_alive():
                raise ValueError("资源操作正在进行，请等待或取消")
            if action == "check" and (not isinstance(directory, str) or not directory.strip() or len(directory) > 4096):
                raise ValueError("请填写解压后的资源目录")
            self.cancel = threading.Event()
            self.state = {"state": "working", "message": "正在准备资源", "current": 0, "total": 0}
            self.thread = threading.Thread(target=self._run, args=(action, directory), daemon=True)
            self.thread.start()
            return self.payload()

    def _run(self, action, directory):
        def progress(message, current=0, total=0):
            with self.lock:
                self.state.update(message=message, current=current, total=total)
        try:
            root = install(self.base / "runtimes", self.cancel, progress) if action == "install" else Path(directory).expanduser().resolve()
            progress("校验文件并试合成")
            node = verify(root, self.cancel)
            from maw.msw.yukkuri import YukkuriSettings, synthesize
            synthesize(YukkuriSettings(validate_recipe({}), root, node), "你好 Hello", self.cancel)
            check_cancel(self.cancel)
            self.save(runtime_path=root)
            with self.lock:
                self.state.update(state="ready", message="资源可用 · 八种音色 · 可离线合成")
        except ResourceCancelled:
            with self.lock:
                self.state.update(state="cancelled", message="已取消；已下载的校验缓存可供重试使用")
        except Exception as error:
            from maw.msw.jobs import JobCancelled
            message = "已取消" if isinstance(error, JobCancelled) else (str(error) if isinstance(error, ValueError) else "资源安装／检测失败，请检查网络、目录和磁盘空间")
            with self.lock:
                self.state.update(state="failed", message=message[:500])

    def close(self):
        self.cancel.set()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="安装、检测或打包 MSW 油库里离线资源（包含 Node）")
    parser.add_argument("action", choices=["install", "check", "pack"])
    parser.add_argument("directory", type=Path, help="安装位置或现有资源目录")
    parser.add_argument("--output", type=Path, help="pack 的 ZIP 输出位置（不覆盖已有文件）")
    args = parser.parse_args()
    cancel = threading.Event()
    root = install(args.directory, cancel, lambda message, *_: print(message, flush=True)) if args.action == "install" else args.directory
    node = verify(root, cancel)
    from maw.msw.yukkuri import YukkuriSettings, synthesize
    synthesize(YukkuriSettings(validate_recipe({}), root, node), "你好 Hello", cancel)
    if args.action == "pack":
        if not args.output:
            parser.error("pack 需要 --output")
        with zipfile.ZipFile(args.output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    archive.write(path, f"msw-yukkuri-{platform_key()}/{path.relative_to(root).as_posix()}")
        print(args.output.resolve())
    else:
        print(root.resolve())


if __name__ == "__main__":
    main()
