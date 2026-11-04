'use strict';
// Disposable QA browser. Trust ONLY the fixture CA and its exact IP leaf;
// no global TLS bypass or production operating-system trust changes.
const {app,BrowserWindow,session}=require('electron'),{X509Certificate}=require('node:crypto'),{readFileSync}=require('node:fs');
app.setName('Bashkar Waiter Isolated QA');
app.whenReady().then(()=>{if(process.env.BASHKAR_QA_ROOT){const ca=new X509Certificate(readFileSync(process.env.BASHKAR_QA_ROOT));session.defaultSession.setCertificateVerifyProc((request,done)=>{try{const leaf=new X509Certificate(request.certificate.data);done(request.hostname==='127.0.0.1'&&leaf.checkIP(request.hostname)===request.hostname&&leaf.verify(ca.publicKey)&&Date.parse(leaf.validTo)>Date.now()&&Date.parse(leaf.validFrom)<=Date.now()&&leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1')?0:-2);}catch{done(-2);}});}const w=new BrowserWindow({width:420,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL(process.env.BASHKAR_QA_URL);});app.on('window-all-closed',()=>app.quit());
