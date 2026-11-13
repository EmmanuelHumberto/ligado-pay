#!/usr/bin/env python3
"""Repair Linux webhook ingress; provider URL, credentials and business data stay intact."""
import argparse,datetime,fcntl,hashlib,importlib.util,json,os,pathlib,re,subprocess,sys,time,urllib.request,urllib.error

BASE=pathlib.Path('/opt/ligado/notification-ingress')
PRIVATE=pathlib.Path('/var/lib/ligado-standby/operational/notification-ingress')
POLICY=pathlib.Path('/etc/ligado-runtime-egress/runtime_egress_policy.py')
TUNNEL=pathlib.Path('/etc/ligado-tunnel/config.yml')
CONTAINER='ligado-notification-ingress-1'
BUILD='840b1d88-d535-485d-95e4-0c72a4cb6b28'
WATCHDOG='ligado-notification-rollback-20261112'

def run(*args,data=None,timeout=90):
    return subprocess.check_output(args,input=data,stderr=subprocess.PIPE,timeout=timeout).decode().strip()
def read(p):return json.loads(p.read_text())
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n');p.chmod(0o600)
def atomic(p,data):
    info=p.stat()
    temp=p.with_name(p.name+'.notification.tmp');temp.write_bytes(data)
    os.chown(temp,info.st_uid,info.st_gid);temp.chmod(info.st_mode&0o777);temp.replace(p)
def validate_live_tunnel():
    # Validation as root would miss a daemon that cannot read its configuration.
    run('runuser','-u','ligado-tunnel','--','cloudflared','--config',str(TUNNEL),'tunnel','ingress','validate')
def tunnel_ready():
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:20241/ready',timeout=1) as response:
                if response.status==200:return True
        except Exception:pass
        time.sleep(0.5)
    return False
def snapshot():
    return {c['Name']:{'id':c['Id'],'image':c['Image']} for c in json.loads(run('docker','inspect',*run('docker','ps','-q').split())) if c['Name']!='/'+CONTAINER}
def helper():
    folder='/opt/ligado/egress-isolation-20261112';sys.path.insert(0,folder)
    spec=importlib.util.spec_from_file_location('containment',folder+'/proteger-egress-runtime.applied.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def compose(*args):return run('docker','compose','--env-file',str(BASE/'release.env'),'-f',str(BASE/'compose.yaml'),*args)
def http(url,body=None,headers=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,data=body,headers=headers or {}),timeout=12) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
def verify():
    c=json.loads(run('docker','inspect',CONTAINER))[0]
    assert c['Config']['User']=='10009:10009' and c['HostConfig']['ReadonlyRootfs'] and c['HostConfig']['CapDrop']==['ALL']
    assert c['HostConfig']['NetworkMode']=='host' and 'no-new-privileges:true' in c['HostConfig']['SecurityOpt']
    assert len(c['Mounts'])==1 and c['Mounts'][0]['Destination']=='/run/ligado/notification-key' and not c['Mounts'][0]['RW']
    assert http('http://127.0.0.1:3344/health/ready')[0]==200
    status,body=http('http://127.0.0.1:3344/ligado-pay/webhooks/infinitepay',b'{}',{'content-type':'application/json','cf-connecting-ip':'203.0.113.252'})
    assert status==400 and body=={'error':'NOTIFICATION_NOT_ACCEPTED'}
    assert http('http://127.0.0.1:3305/webhooks/infinitepay',b'{}',{'content-type':'application/json'})[0]==403
    assert http('http://127.0.0.1:3344/v1/payments',b'{}',{'content-type':'application/json'})[0]==404
    code="const n=require('node:net');Promise.all([5432,55439,9000,22].map(port=>new Promise(ok=>{const s=n.connect({host:'127.0.0.1',port});s.setTimeout(1500,()=>{s.destroy();ok(false)});s.on('connect',()=>{s.destroy();ok(true)});s.on('error',()=>ok(false));}))).then(v=>{if(v.some(Boolean))process.exit(1);console.log('DENIED')})"
    assert run('docker','exec',CONTAINER,'node','-e',code)=='DENIED'
    audit=json.loads(run('python3','/etc/ligado-runtime-egress/ligado-runtime-egress.py','--audit'));assert audit['result']=='PASSOU'
    return {'signedInvalidHintReachedGatewayAndWasRejected':True,'unsignedDirectGatewayDenied':True,
            'paymentCreationRouteUnavailable':True,'ingressCannotReachDatabasesStorageOrSsh':True,
            'onlyProxyKeyMounted':True,'runtimeFirewallAuditPassed':True}
def rollback(work):
    # Restore routing before removing the replacement receiver; never stop Docker.
    if (work/'config.before.yml').exists():
        atomic(TUNNEL,(work/'config.before.yml').read_bytes())
        validate_live_tunnel()
        run('systemctl','restart','ligado-tunnel.service',timeout=40)
        assert tunnel_ready()
    # Remove the extra runtime before reverting the audit identity set.
    if BASE.exists():
        r=subprocess.run(['docker','inspect',CONTAINER],capture_output=True)
        if r.returncode==0:
            c=json.loads(r.stdout)[0]
            assert c['Config']['Labels']['com.docker.compose.project']=='ligado-notification'
            assert c['Image']==read(work/'image.json')['image']
            run('docker','rm','-f',CONTAINER)
    if (work/'policy.before.py').exists():
        atomic(POLICY,(work/'policy.before.py').read_bytes())
        run('python3','/etc/ligado-runtime-egress/ligado-runtime-egress.py')
    run('systemctl','start','ligado-runtime-egress-audit.timer')
    save(work/'rollback.json',{'result':'ROLLED_BACK','providerConfigurationChanged':False,'dockerStopped':False})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--work',required=True);parser.add_argument('--apply',action='store_true');parser.add_argument('--rollback',action='store_true');a=parser.parse_args()
    assert os.geteuid()==0
    work=pathlib.Path(a.work).resolve();assert work==pathlib.Path('/opt/ligado/notification-migration-20261112') and work.stat().st_uid==0 and work.stat().st_mode&0o077==0
    if a.rollback:rollback(work);return
    op=pathlib.Path('/run/ligado-backup-operation.lock').open('a');fcntl.flock(op,fcntl.LOCK_EX|fcntl.LOCK_NB)
    store=pathlib.Path('/opt/ligado/store-staging/audit-publication.lock').open('a');fcntl.flock(store,fcntl.LOCK_EX|fcntl.LOCK_NB)
    phase='preflight';mutated=False;watchdog=False
    try:
        assert not(work/'started').exists() and not BASE.exists() and not PRIVATE.exists()
        assert not pathlib.Path('/run/ligado-backup.lock').exists() and not pathlib.Path('/opt/ligado/production/maintenance.json').exists()
        assert read(pathlib.Path('/opt/ligado/production/active.json'))['buildId']==BUILD
        key=pathlib.Path('/var/lib/ligado-standby/operational/gateway/notification-key').read_bytes().strip()
        assert re.fullmatch(rb'[A-Za-z0-9_-]{43}',key)
        image=read(work/'image.json');test=read(work/'policy/isolated-test.json')
        assert image['linuxTestsPassed']==8 and test['result']=='PASSOU' and test['caseCount']==128
        assert test['policySha256']==hashlib.sha256((work/'policy/runtime_egress_policy.py').read_bytes()).hexdigest()
        assert image['sourceSha256']==hashlib.sha256((work/'infra/vps/notification-ingress.mjs').read_bytes()).hexdigest()
        info=json.loads(run('docker','image','inspect',image['image']))[0]
        assert info['Config']['User']=='10009:10009' and info['Config']['Labels']['org.ligado.notification-source-sha256']==image['sourceSha256']
        original=TUNNEL.read_text();assert original.count('ingress:\n')==1 and ':3344' not in original
        validate_live_tunnel();assert tunnel_ready()
        candidate=original.replace('ingress:\n',"ingress:\n  - hostname: os.ligadotattoo.com.br\n    path: '^/ligado-pay/webhooks/infinitepay$'\n    service: http://127.0.0.1:3344\n",1)
        (work/'config.candidate.yml').write_text(candidate);(work/'config.candidate.yml').chmod(0o600)
        run('cloudflared','--config',str(work/'config.candidate.yml'),'tunnel','ingress','validate')
        assert helper().app_module().healthy(BUILD)
        run('python3','/etc/ligado-runtime-egress/ligado-runtime-egress.py','--audit')
        if not a.apply:print(json.dumps({'result':'PREFLIGHT_PASSED','providerUrlUnchanged':True}));return
        phase='backup-before';before=helper().backup(work,'backup-before');containers=snapshot()
        for name,content in [('config.before.yml',TUNNEL.read_bytes()),('policy.before.py',POLICY.read_bytes())]:
            (work/name).write_bytes(content);(work/name).chmod(0o600)
        (work/'started').touch(mode=0o600)
        phase='prepare';BASE.mkdir(mode=0o700);PRIVATE.mkdir(mode=0o700);os.chown(PRIVATE,10009,10009)
        secret=PRIVATE/'notification-key';secret.write_bytes(key);secret.chmod(0o600);os.chown(secret,10009,10009)
        (BASE/'compose.yaml').write_bytes((work/'infra/vps/notification-ingress.compose.yaml').read_bytes());(BASE/'compose.yaml').chmod(0o600)
        (BASE/'release.env').write_text('NOTIFICATION_IMAGE='+image['image']+'\nNOTIFICATION_PRIVATE_DIR='+str(PRIVATE)+'\n');(BASE/'release.env').chmod(0o600)
        run('systemd-run','--unit',WATCHDOG,'--on-active=10min','/usr/bin/python3',str(pathlib.Path(__file__).resolve()),'--work',str(work),'--rollback');watchdog=True;mutated=True
        phase='container';compose('up','-d','--pull','never')
        for _ in range(30):
            try:
                if http('http://127.0.0.1:3344/health/ready')[0]==200:break
            except Exception:pass
            time.sleep(1)
        else:raise RuntimeError('Ingress unavailable')
        phase='policy';run('systemctl','stop','ligado-runtime-egress-audit.timer')
        atomic(POLICY,(work/'policy/runtime_egress_policy.py').read_bytes())
        run('python3','/etc/ligado-runtime-egress/ligado-runtime-egress.py')
        proof=verify();save(work/'local-proof.json',proof)
        phase='route';atomic(TUNNEL,(work/'config.candidate.yml').read_bytes())
        validate_live_tunnel()
        run('systemctl','restart','ligado-tunnel.service',timeout=40)
        assert tunnel_ready()
        run('systemctl','start','ligado-runtime-egress-audit.timer')
        assert helper().app_module().healthy(BUILD) and snapshot()==containers
        helper().verify(BUILD)
        phase='backup-after';after=helper().backup(work,'backup-after')
        assert not(work/'rollback.json').exists() and snapshot()==containers
        proof=verify();run('systemctl','stop',WATCHDOG+'.timer');watchdog=False
        run('systemctl','start','ligado-runtime-egress-audit.service')
        result={'result':'PUBLISHED','executedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'buildId':BUILD,
                'ingressImage':image['image'],'sourceSha256':image['sourceSha256'],'localProof':proof,
                'backupBefore':before,'backupAfter':after,'previousApplicationContainersPreserved':True,
                'providerUrlChanged':False,'providerCredentialsChanged':False,'applicationImagesChanged':False,
                'financialOperationExecuted':False,'driveSynchronizationExecuted':False,'networkCases':128,'linuxIngressTests':8}
        save(work/'result.json',result);print(json.dumps({k:v for k,v in result.items() if k not in ['localProof','backupBefore','backupAfter']}))
    except Exception as e:
        recovered=False
        if mutated:
            try:rollback(work);recovered=True
            except Exception:pass
        if watchdog:subprocess.run(['systemctl','stop',WATCHDOG+'.timer'],capture_output=True)
        result={'result':'INCOMPLETE','phase':phase,'kind':type(e).__name__,'previousRouteRecovered':recovered,'privateDetailsOmitted':True}
        save(work/'failure.json',result);print(json.dumps(result));raise SystemExit(1)

if __name__=='__main__':main()
