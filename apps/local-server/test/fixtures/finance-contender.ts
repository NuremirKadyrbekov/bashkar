import Database from 'better-sqlite3';
import {CommandBus} from '../../src/command-bus';
import {AuthService} from '../../src/modules/auth/auth-service';
import {MenuService} from '../../src/modules/menu/menu-service';
import {TableService} from '../../src/modules/tables/table-service';
import {OrderService} from '../../src/modules/orders/order-service';
import {FinanceService} from '../../src/modules/orders/finance-service';
// Test-only adversarial connections bypass the shipped instance lock.
process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',chunk=>{input+=chunk;});
process.stdin.on('end',async()=>{const data=JSON.parse(input),db=new Database(data.path);db.pragma('foreign_keys=ON');db.pragma('synchronous=FULL');db.pragma('busy_timeout=5000');const bus=new CommandBus(db),auth=new AuthService(db,bus,data.branchId),menu=new MenuService(db,bus,auth),tables=new TableService(db,bus,auth),finance=new FinanceService(new OrderService(db,bus,auth,menu,tables));
 try{const result=await finance.settle(data.token,data.orderId,data.input,data.commandId);process.stdout.write(JSON.stringify({ok:true,id:result.settlementId}));}catch(error){process.stdout.write(JSON.stringify({ok:false,code:error instanceof Error?error.message:'ERROR'}));}finally{db.close();}});
