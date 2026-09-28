"""Bundle runner: preserve its cwd/imports, prohibit implicit resource downloads."""

import ipaddress
from pathlib import Path
import runpy
import sys


def local_network_only(event, args):
    if event in {'socket.connect', 'socket.getaddrinfo'}:
        address = args[1] if event == 'socket.connect' else (args[0], args[1])
        if isinstance(address, tuple):
            host = address[0]
            if host != 'localhost':
                try:
                    allowed = ipaddress.ip_address(host).is_loopback
                except ValueError:
                    allowed = False
                if not allowed:
                    raise OSError('MSW 本机服务不自动联网下载资源，请先在原工具中准备模型')


if __name__ == '__main__':
    root, kind = Path(sys.argv[1]).resolve(), sys.argv[2]
    script = {'indextts': 'webui.py', 'gpt-sovits': 'api_v2.py'}[kind]
    sys.path.insert(0, str(root))
    sys.argv = [str(root / script), *sys.argv[3:]]
    sys.addaudithook(local_network_only)
    print(f'MSW: 正在导入 {kind} 并加载本机模型；不会自动下载资源。', flush=True)
    runpy.run_path(str(root / script), run_name='__main__')
