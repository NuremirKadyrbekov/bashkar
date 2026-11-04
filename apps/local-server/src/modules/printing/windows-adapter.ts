import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PosError, requireCondition } from '../../errors';
export type PrinterInventory = {
    queueName: string;
    driverName: string;
    portName: string;
    physicalId: string;
};
export type PrintDevice = PrinterInventory & {
    id: string;
    revision: number;
    profile: any;
};
export type Transmission = {
    state: 'SENT' | 'FAILED_SAFE' | 'UNKNOWN';
    evidence: Record<string, unknown>;
};
export interface PrintAdapter {
    inventory(): Promise<PrinterInventory[]>;
    send(device: PrintDevice, raw: Buffer, documentName: string): Promise<Transmission>;
}
export class WindowsPrintAdapter implements PrintAdapter {
    constructor(private readonly helper = resolve('infrastructure/printing/bin/RawPrint.exe')) { }
    private call(action: string, metadata: unknown, raw?: Buffer): Promise<{
        code: number | null;
        messages: any[];
        timeout: boolean;
    }> { return new Promise((done, reject) => { const child = spawn(this.helper, [action], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', size = 0, timed = false; const timer = setTimeout(() => { timed = true; child.kill(); }, action === 'list' ? 10000 : 30000); child.stdout.on('data', b => { size += b.length; if (size > 65536) {
        child.kill();
        return;
    } output += b; }); child.stderr.on('data', () => { }); child.once('error', e => { clearTimeout(timer); reject(e); }); child.once('close', code => { clearTimeout(timer); try {
        done({ code, messages: output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), timeout: timed });
    }
    catch {
        done({ code: 1, messages: [], timeout: timed });
    } }); child.stdin.on('error', () => { }); const json = Buffer.from(JSON.stringify(metadata)), length = Buffer.alloc(4); length.writeUInt32LE(json.length); child.stdin.write(length); child.stdin.write(json); child.stdin.end(raw); }); }
    async inventory(): Promise<PrinterInventory[]> { if (process.platform !== 'win32')
        return []; let result; try {
        result = await this.call('list', {});
    }
    catch {
        throw new PosError('PRINT_HELPER_UNAVAILABLE', 503);
    } requireCondition(result.code === 0 && !result.timeout, 'PRINT_INVENTORY_UNAVAILABLE', 503); const list = result.messages.find(m => Array.isArray(m.printers))?.printers ?? []; return list.filter((p: any) => typeof p.queueName === 'string' && typeof p.portName === 'string' && /^USB\d+$/i.test(p.portName) && typeof p.driverName === 'string').map((p: any) => ({ queueName: p.queueName, driverName: p.driverName, portName: p.portName, physicalId: createHash('sha256').update(String(p.hardwareId || p.portName).toUpperCase()).digest('hex') })); }
    async send(device: PrintDevice, raw: Buffer, documentName: string): Promise<Transmission> {
        if (process.platform !== 'win32')
            return { state: 'FAILED_SAFE', evidence: { stage: 'PLATFORM', code: 'WINDOWS_USB_REQUIRED' } };
        // An inventory failure precedes StartDoc and cannot have spooled this attempt.
        try {
            const rows = await this.inventory();
            requireCondition(rows.some(p => p.queueName === device.queueName && p.physicalId === device.physicalId && p.driverName === device.driverName && p.portName === device.portName), 'PRINT_DEVICE_IDENTITY_CHANGED');
        }
        catch {
            return { state: 'FAILED_SAFE', evidence: { stage: 'BEFORE_HELPER', code: 'PRINT_DEVICE_IDENTITY_CHANGED' } };
        }
        try {
            const result = await this.call('send', { queueName: device.queueName, driverName: device.driverName, portName: device.portName, documentName, size: raw.length }, raw);
            const terminal = result.messages.find(m => m.state === 'SENT' || m.state === 'FAILED_SAFE' || m.state === 'UNKNOWN');
            const job = result.messages.find(m => m.osJobId);
            if (result.timeout)
                return { state: 'UNKNOWN', evidence: { stage: 'HELPER_TIMEOUT', osJobId: job?.osJobId ?? null } };
            if (terminal)
                return { state: terminal.state, evidence: { stage: terminal.stage ?? 'HELPER', osJobId: terminal.osJobId ?? job?.osJobId ?? null, written: terminal.written ?? null, code: terminal.code ?? null } };
            return { state: 'UNKNOWN', evidence: { stage: 'HELPER_NO_RESULT', osJobId: job?.osJobId ?? null } };
        }
        catch {
            return { state: 'UNKNOWN', evidence: { stage: 'HELPER_START_OR_CHANNEL_FAILURE' } };
        }
    }
}
