import copy
import json
import tempfile
import unittest
from pathlib import Path

from maw import asr_presets as presets
from maw.user_config import UserConfig, config_path, ConfigConflict
from maw.config_transfer import package, parse
from maw.gui_web import _request_from_payload, PreflightError
from maw.msw.asr_config import resolve_settings


class AsrPresetTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.env = Path(temp.name) / 'synthetic.env'
        self.env.write_text('DASHSCOPE_API_KEY=synthetic-key\nOPENAI_API_KEY=synthetic-key\n', encoding='utf-8')
        self.store = UserConfig(config_path(self.env), env_path=self.env)

    def save(self, name='节目', **values):
        return presets.request(self.env, {'action':'save','name':name,'description':'人物与背景',
            'options':{'language':'zh','gapSplit':'500','asrPrompts':{'text':'剧情背景','overrides':{}},**values}})['presets'][-1]

    def test_library_lifecycle_conflicts_and_recoverable_deletion(self):
        first=self.save()
        copy_row=presets.request(self.env,{'action':'copy','id':first['id'],'before':first,'name':'节目副本'})['presets'][-1]
        self.assertEqual(copy_row['options'],first['options'])
        with self.assertRaises(ValueError):self.save()
        changed=presets.request(self.env,{'action':'save','id':first['id'],'before':first,'name':'新名称','description':'新说明','options':first['options']})['presets'][0]
        with self.assertRaises(ConfigConflict):presets.request(self.env,{'action':'delete','id':first['id'],'before':first})
        deleted=presets.request(self.env,{'action':'delete','id':changed['id'],'before':changed})['presets'][0]
        self.assertTrue(deleted['deleted'])
        restored=presets.request(self.env,{'action':'restore','id':deleted['id'],'before':deleted})['presets'][0]
        self.assertEqual(restored,changed)
        self.assertTrue(self.store.path.with_suffix('.mswconfig.bak').is_file())

    def test_import_preview_merge_and_stale_preview(self):
        first=self.save()
        raw=package(self.store.read()['sections'],['asr'])
        self.assertEqual(parse(raw),raw)
        other=copy.deepcopy(first);other['id']='a'*32;other['name']='其他节目'
        raw['sections']['asr']['presets'].append(other)
        payload=dict(package=raw,categories=['asr'],policy='keep')
        preview=self.store.request({'action':'preview',**payload})
        self.assertEqual(len(self.store.read()['sections']['asr']['presets']),1)
        self.store.request({'action':'import',**payload,'token':preview['token'],'revision':preview['revision']})
        self.assertEqual(len(self.store.read()['sections']['asr']['presets']),2)
        preview=self.store.request({'action':'preview',**payload})
        self.save('新节目')
        with self.assertRaises(ConfigConflict):self.store.request({'action':'import',**payload,'token':preview['token'],'revision':preview['revision']})

    def test_sensitive_fields_paths_and_invalid_values_rejected(self):
        for field in ['apiKey','workspaceId','openaiBaseUrl','mediaPath','localModelPath','qwenAudioVocabularyId','qwenAudioHotwordsFile','modelId']:
            with self.subTest(field=field),self.assertRaises(ValueError):self.save(**{field:'private-value'})
        for values in [{'speakerColors':'true'},{'gapSplit':'-1'},{'maxLen':'2','minLen':'5'},
                       {'qwenAudioHotwordWeight':'6'},{'language':'bad\0value'},
                       {'asrPrompts':{'text':'text','overrides':{'unknown':'x'}}}]:
            with self.subTest(values=values),self.assertRaises(ValueError):self.save(**values)
        self.assertFalse(self.store.read()['sections'].get('asr',{}).get('presets'))

    def test_legacy_context_migration_and_prompt_concurrency(self):
        same=presets.migrate_prompts({'qwenAudioContext':'shared','openaiPrompt':'shared'})
        self.assertEqual(same,{'text':'shared','overrides':{}})
        self.assertEqual(presets.migrate_prompts({'qwenAudioContext':'Names','openaiPrompt':''}),
                         {'text':'','overrides':{'qwen':'Names','openai':''}})
        old={'qwenAudioContext':'Qwen old','openaiPrompt':'OpenAI old','sonioxContextText':'Soniox old'}
        self.env.write_text('MSW_EDITOR_ASR_OPTIONS='+json.dumps(old)+'\n',encoding='utf-8')
        migrated=presets.request(self.env)['prompts']
        self.assertEqual(migrated['text'],'')
        self.assertEqual(migrated['overrides'],{'qwen':'Qwen old','openai':'OpenAI old','soniox':'Soniox old'})
        updated={'text':'Shared new','overrides':{'openai':''}}
        presets.request(self.env,{'action':'prompts','before':migrated,'value':updated})
        with self.assertRaises(ConfigConflict):presets.request(self.env,{'action':'prompts','before':migrated,'value':same})
        self.assertEqual(presets.request(self.env)['prompts'],updated)
        self.assertEqual(presets.resolve_prompts({'asrPrompts':updated})['openaiPrompt'],'')
        raw=package({'asr':{}},['asr'])
        args=dict(package=raw,categories=['asr'],policy='replace')
        preview=self.store.request({'action':'preview',**args})
        self.store.request({'action':'import',**args,'token':preview['token'],'revision':preview['revision']})
        self.assertEqual(presets.request(self.env)['prompts'],{'text':'','overrides':{}})

    def test_actual_requests_use_frozen_context_and_enforce_capabilities(self):
        context={'text':'背景','overrides':{'qwen':'角色名'}}
        payload={'providerId':'qwen','modelId':'qwen-audio-3.0-asr-flash-filetrans','apiKey':'synthetic-key',
                 'mediaPath':'synthetic.wav','srtPath':'synthetic.srt','asrPrompts':context}
        req=_request_from_payload(payload,self.env,validate_media=False)
        self.assertEqual(req.qwen_audio_context,'角色名')
        editor=resolve_settings(self.env,payload,validate_runtime=False)
        self.assertEqual(editor.recipe['qwen_audio_context'],'角色名')
        context['overrides']['qwen']='later edit'
        self.assertEqual(req.qwen_audio_context,'角色名')
        no_context=_request_from_payload({**payload,'modelId':'fun-asr'},self.env,validate_media=False)
        self.assertEqual(no_context.qwen_audio_context,'')
        with self.assertRaises(PreflightError):_request_from_payload({**payload,'asrPrompts':{'text':'字'*401,'overrides':{}}},self.env,validate_media=False)
        diarize=_request_from_payload({**payload,'providerId':'openai','modelId':'gpt-4o-transcribe-diarize','openaiBaseUrl':'https://api.openai.com/v1'},self.env,validate_media=False)
        self.assertEqual(diarize.openai_prompt,'')
        self.assertTrue(diarize.openai_diarize)

    def test_corrupt_store_is_not_replaced(self):
        self.store.path.write_text('broken',encoding='utf-8')
        with self.assertRaises(ValueError):self.save()
        self.assertEqual(self.store.path.read_text(encoding='utf-8'),'broken')

    def test_keep_import_retains_local_prompt_semantics_and_case_insensitive_names(self):
        row=self.save('Series')
        other=copy.deepcopy(row);other.update(id='b'*32,name='series')
        local=self.store.read()['sections']['asr']['prompts']
        raw=package({'asr':{'presets':[other],'prompts':{'text':'incoming','overrides':{'qwen':'extra'}}}},['asr'])
        args=dict(package=raw,categories=['asr'],policy='keep')
        preview=self.store.request({'action':'preview',**args})
        self.store.request({'action':'import',**args,'token':preview['token'],'revision':preview['revision']})
        result=presets.request(self.env)
        self.assertEqual(result['prompts'],local)
        self.assertEqual(result['presets'],[row])

    def test_restore_allows_renaming_when_name_was_reused(self):
        row=self.save()
        deleted=presets.request(self.env,{'action':'delete','id':row['id'],'before':row})['presets'][0]
        self.save()
        with self.assertRaises(ValueError):presets.request(self.env,{'action':'restore','id':row['id'],'before':deleted})
        restored=presets.request(self.env,{'action':'restore','id':row['id'],'before':deleted,'name':'恢复的节目'})['presets'][0]
        self.assertEqual(restored['name'],'恢复的节目')
        self.assertFalse(restored['deleted'])
