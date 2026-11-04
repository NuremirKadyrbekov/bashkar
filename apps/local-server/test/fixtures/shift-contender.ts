import Database from 'better-sqlite3';
import { CommandBus } from '../../src/command-bus';
import { AuthService } from '../../src/modules/auth/auth-service';
import { ShiftService } from '../../src/modules/shifts/shift-service';
// Adversarial DB concurrency test, intentionally bypassing the single-process
// lock. This fixture is not part of the shipped server entrypoint.
process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',chunk=>{input+=chunk;});
process.stdin.on('end',async()=>{
 const {path,branchId,token,commandId,password}=JSON.parse(input);const db=new Database(path);db.pragma('foreign_keys=ON');db.pragma('synchronous=FULL');db.pragma('busy_timeout=5000');
 const bus=new CommandBus(db),auth=new AuthService(db,bus,branchId),shifts=new ShiftService(db,bus,auth);
 try{const result=await shifts.open(token,commandId,'owner',password);process.stdout.write(JSON.stringify({ok:true,id:result.id}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,code:error instanceof Error?error.message:'ERROR'}));}
 finally{db.close();}
});
