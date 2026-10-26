import copy
import tempfile
import unittest
from pathlib import Path
from maw.user_config import UserConfig, ConfigConflict
from maw.config_transfer import package, parse
from maw.msw.speaker_schemes import validate
from maw.msw.speaker_palette import validate as validate_palette


def library():
    return dict(version=1, schemes=[dict(id='series', name='团录', rows=[dict(id='person-1', name='Erwyn', names={'zh-hans':'艾尔文'}, color='#123456', mode='stroke', separator='：', style={'fontSize':60})])])


class SpeakerSchemeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.store=UserConfig(Path(self.temp.name)/'user-settings.mswconfig')

    def test_export_import_and_conflict_are_atomic_and_do_not_include_projects(self):
        self.store.update(['speakerSchemes'],library())
        raw=self.store.request(dict(action='export',categories=['speakerSchemes']))['package']
        self.assertEqual(raw,package({'speakerSchemes':library()},['speakerSchemes']))
        fresh=UserConfig(Path(self.temp.name)/'new-config.mswconfig')
        req=dict(package=raw,categories=['speakerSchemes'],policy='keep')
        preview=fresh.request(dict(action='preview',**req))
        fresh.request(dict(action='import',**req,revision=preview['revision'],token=preview['token']))
        self.assertEqual(fresh.read()['sections'],{'speakerSchemes':library()})
        old=copy.deepcopy(library());new=copy.deepcopy(old);new['schemes'][0]['name']='changed'
        self.store.patch([dict(path=['speakerSchemes'],exists=True,before=old,value=new)])
        with self.assertRaises(ConfigConflict):self.store.patch([dict(path=['speakerSchemes'],exists=True,before=old,value=library())])
        self.assertEqual(self.store.read()['sections']['speakerSchemes'],new)

    def test_import_keep_and_replace_only_selected_library(self):
        self.store.update(['speakerSchemes'],library());self.store.update(['browser','mawe.language'],'en')
        incoming=library();incoming['schemes'][0]['rows'][0]['name']='changed'
        incoming['schemes'].append(dict(id='other',name='其他',rows=copy.deepcopy(incoming['schemes'][0]['rows'])))
        raw=package({'speakerSchemes':incoming},['speakerSchemes'])
        for policy in ('keep','replace'):
            req=dict(package=raw,categories=['speakerSchemes'],policy=policy)
            p=self.store.request(dict(action='preview',**req));self.store.request(dict(action='import',**req,token=p['token'],revision=p['revision']))
            state=self.store.read()['sections'];self.assertEqual(state['browser']['mawe.language'],'en')
            self.assertEqual(len(state['speakerSchemes']['schemes']),2)
            self.assertEqual(state['speakerSchemes']['schemes'][0]['rows'][0]['name'],'Erwyn' if policy=='keep' else 'changed')

    def test_strict_validation_and_project_provenance(self):
        for patch in ({'cue_id':'private'},{'style':{'fontSize':-1}},{'scheme_ref':{'scheme_id':'series','person_id':'person-1'}},{'names':{'zh':'bad'}}):
            invalid=library();invalid['schemes'][0]['rows'][0].update(patch)
            with self.assertRaises(ValueError):parse(package({'speakerSchemes':invalid},['speakerSchemes']))
        validate(library())
        row=library()['schemes'][0]['rows'][0];row['scheme_ref']={'scheme_id':'series','person_id':'person-1'}
        validate_palette(dict(version=1,rows=[row]))
        row['scheme_ref']['private']=1
        with self.assertRaises(ValueError):validate_palette(dict(version=1,rows=[row]))
