import importlib.util,os,pathlib,subprocess,sys,tempfile,unittest
from unittest.mock import patch

@unittest.skipUnless(sys.platform=='linux','Publication is Linux-only; test on the VPS.')
class PublicationTests(unittest.TestCase):
    def load(self):
        path=pathlib.Path(__file__).resolve().parents[1]/'scripts/publicar-notification-ingress.py'
        spec=importlib.util.spec_from_file_location('notification_publication',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

    @unittest.skipUnless(hasattr(os,'geteuid') and os.geteuid()==0,'Owner preservation needs root and a non-root reader.')
    def test_atomic_update_preserves_non_root_owner_group_mode_and_read_access(self):
        import pwd
        module=self.load();reader=pwd.getpwnam('nobody')
        with tempfile.TemporaryDirectory() as folder:
            directory=pathlib.Path(folder);directory.chmod(0o755)
            file=directory/'config';file.write_bytes(b'old');os.chown(file,reader.pw_uid,reader.pw_gid);file.chmod(0o600)
            module.atomic(file,b'new');st=file.stat()
            self.assertEqual((st.st_uid,st.st_gid,st.st_mode&0o777),(reader.pw_uid,reader.pw_gid,0o600))
            actual=subprocess.check_output(['runuser','-u',reader.pw_name,'--','cat',str(file)])
            self.assertEqual(actual,b'new')

    def test_validation_uses_service_identity_not_root(self):
        module=self.load()
        with patch.object(module,'run') as run:
            module.validate_live_tunnel()
            self.assertEqual(run.call_args.args[:4],('runuser','-u','ligado-tunnel','--'))

    def test_readiness_waits_until_connector_returns_200(self):
        module=self.load()
        class Ready:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
        with patch.object(module.urllib.request,'urlopen',side_effect=[OSError('not ready'),Ready()]) as request,patch.object(module.time,'sleep'):
            self.assertTrue(module.tunnel_ready());self.assertEqual(request.call_count,2)

    def test_connector_stuck_restarting_does_not_pass_readiness(self):
        module=self.load()
        with patch.object(module.urllib.request,'urlopen',side_effect=OSError('not ready')),patch.object(module.time,'sleep'):
            self.assertFalse(module.tunnel_ready())

if __name__=='__main__':unittest.main()
