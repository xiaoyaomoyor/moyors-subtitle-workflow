from unittest import TestCase, mock
import maw_gui


class EditorEntryTests(TestCase):
    def test_direct_editor_passes_server_arguments_without_starting_launcher(self):
        for args in [[], ['--blank','--port','0','--no-open'], ['project.mosp','--no-waveform'], ['--help']]:
            with self.subTest(args=args), mock.patch.object(maw_gui, '_run_internal_serve', return_value=0) as serve:
                self.assertEqual(maw_gui.main(['--editor', *args]), 0)
                serve.assert_called_once_with(args)

    def test_default_entry_still_starts_launcher(self):
        with mock.patch('maw.gui_web.run_app', return_value=0) as app:
            self.assertEqual(maw_gui.main([]), 0)
            app.assert_called_once()
