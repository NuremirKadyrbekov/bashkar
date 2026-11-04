import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { audit, CommandBus, outbox } from '../../command-bus';
import { requireCondition } from '../../errors';
import { AuthService } from '../auth/auth-service';
export class ShiftService {
  constructor(readonly db:Database.Database, readonly bus:CommandBus, readonly auth:AuthService, readonly now=Date.now) {}
  current(token:string) {
    this.auth.current(token);
    return this.db.prepare("SELECT s.id,s.status,s.opened_by AS openedBy,e.name AS openedByName,s.opened_at AS openedAt,s.revision FROM shifts s JOIN employees e ON e.id=s.opened_by AND e.branch_id=s.branch_id WHERE s.branch_id=? AND s.status='OPEN'").get(this.auth.branchId) ?? null;
  }
  async open(token:string,id:string,login:unknown,password:unknown,pinProof?:{credential_version:number;must_change:number}) {
    const actor=this.auth.current(token,'shift.open');const checked=pinProof??await this.auth.prove(login,password,actor.id);
    requireCondition(checked.must_change===0,'PASSWORD_CHANGE_REQUIRED',401);
    return this.bus.run({id,type:'shift.open',actor,payload:{}},()=>{
      const fresh=this.auth.current(token,'shift.open');requireCondition(fresh.employee.credential_version===checked.credential_version,'CREDENTIALS_CHANGED',401);
    },()=>{
      requireCondition(!this.current(token),'SHIFT_ALREADY_OPEN');const shiftId=randomUUID(),openedAt=this.now();
      this.db.prepare("INSERT INTO shifts(id,branch_id,status,opened_by,opened_at) VALUES(?,?,'OPEN',?,?)").run(shiftId,actor.branchId,actor.id,openedAt);
      const result={id:shiftId,status:'OPEN',openedBy:actor.id,openedByName:actor.employee.name,openedAt,revision:1};
      audit(this.db,actor,'shift.open',shiftId,id,openedAt);outbox(this.db,actor.branchId,'shift.opened',result,openedAt);return result;
    });
  }
}
