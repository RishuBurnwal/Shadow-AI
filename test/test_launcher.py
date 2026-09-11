import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).resolve().parents[1] / 'main.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_comma_numbered_and_disabled_keys(self):
        with patch.dict(os.environ, {'GROQ_API_KEY':'a, a, , #disabled', 'GROQ_API_KEY_2':'b', 'OPENAI_API_KEY':',#off'}, clear=True):
            self.assertEqual(launcher.provider_keys('GROQ_API_KEY'), ['a','b'])
            self.assertEqual(launcher.configured_providers(), ['groq'])

    def test_environment_refresh_preserves_external_override(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'EXTERNAL':'keep'}, clear=True):
            launcher._loaded_env.clear()
            env = Path(directory) / '.env'
            env.write_text('GROQ_API_KEY=old\nEXTERNAL=replace')
            launcher.load_env(env)
            env.write_text('GROQ_API_KEY=new')
            launcher.load_env(env)
            self.assertEqual(os.environ['GROQ_API_KEY'], 'new')
            self.assertEqual(os.environ['EXTERNAL'], 'keep')
            env.write_text('')
            launcher.load_env(env)
            self.assertNotIn('GROQ_API_KEY', os.environ)
            launcher._loaded_env.clear()

    def test_exact_remote_validation(self):
        for url in ['https://github.com/RishuBurnwal/Shadow-AI.git', 'git@github.com:RishuBurnwal/Shadow-AI.git']:
            self.assertTrue(launcher.repository_matches_expected_remote(url))
        self.assertFalse(launcher.repository_matches_expected_remote('https://evil.example/github.com:rishuburnwal/shadow-ai'))

    def test_fast_failed_startup(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher,'ROOT',Path(directory)), patch.object(launcher.time,'sleep') as sleep:
            self.assertFalse(launcher.wait_for_readiness(Mock(poll=lambda:1)))
            sleep.assert_not_called()

    def test_keyless_diagnostics(self):
        with patch.dict(os.environ,{},clear=True), patch.object(launcher,'load_env'):
            self.assertEqual(launcher.launch(launcher.menu_args(info=True)),0)

    def test_keyless_launch_reaches_runtime(self):
        with patch.dict(os.environ,{},clear=True), patch.object(launcher,'load_env'), patch.object(launcher,'npm_command',return_value='npm'), patch.object(launcher.subprocess,'run',return_value=Mock(returncode=0)) as run:
            args=launcher.menu_args(skip_install=True,skip_update=True);args.wait=True
            self.assertEqual(launcher.launch(args),0)
            run.assert_called_once()

    def test_main_handles_missing_executable(self):
        with patch.object(launcher,'load_env'), patch.object(launcher.sys,'argv',['main.py']), patch.object(launcher,'interactive_menu',side_effect=FileNotFoundError('missing tool')):
            self.assertEqual(launcher.main(),2)

    def test_updater_leaves_running_process_when_branch_diverged(self):
        replies=['https://github.com/RishuBurnwal/Shadow-AI.git','','local','remote']
        with patch.object(launcher,'git_output',side_effect=replies), patch.object(launcher.shutil,'which',return_value='git'), patch.object(launcher.subprocess,'run',side_effect=[Mock(returncode=0),Mock(returncode=1),Mock(returncode=1)]), patch.object(launcher,'stop_running_project') as stop:
            self.assertEqual(launcher.update_project(restart=False),2)
            stop.assert_not_called()

if __name__=='__main__': unittest.main()
