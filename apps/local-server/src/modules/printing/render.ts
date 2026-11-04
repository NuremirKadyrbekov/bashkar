import { Resvg } from '@resvg/resvg-js';
import { resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { requireCondition } from '../../errors';
export type PrintProfile = {
    model: 'XP-365B';
    mode: 'ESC_POS_RECEIPT';
    dpi: 203;
    width: number;
    feed: number;
    cutter: false;
    kitchenTextSize?: 'NORMAL' | 'LARGE';
};
export const defaultPrintProfile: PrintProfile = { model: 'XP-365B', mode: 'ESC_POS_RECEIPT', dpi: 203, width: 576, feed: 24, cutter: false };
const escape = (s: unknown) => String(s ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => `${Math.floor(n / 100)},${String(n % 100).padStart(2, '0')}`;
export function receiptLines(type: string, purpose: string, payload: any, repeat = false, now = Date.now()) {
    const ky = payload.language === 'ky', name = (r: any) => ky ? (r.translations?.ky ?? r.name ?? r.label ?? '') : (r.translations?.ru ?? r.name ?? r.label ?? '');
    const lines: {
        text: string;
        size: number;
    }[] = [], add = (text: unknown, size = 22) => lines.push({ text: String(text ?? ''), size });
    if (repeat)
        add(ky ? 'КАЙТАЛОО' : 'ПОВТОР', 32);
    if (type === 'DIAGNOSTIC') {
        add('BASHKAR.KG — ТЕСТ', 30);
        add('Xprinter XP-365B / USB / ESC-POS');
        add('Ө ө Ү ү Ң ң · Кыргызча / Русский', 26);
        add('КУХНЯ / КЛИЕНТСКИЙ ЧЕК');
        add('1234567890 · 0,00 сом');
        add(new Date(now).toISOString());
        return lines;
    }
    if (type === 'KITCHEN') {
        add(payload.type === 'COUNTER' ? (ky ? 'АЛЫП КЕТҮҮ' : 'НА ВЫНОС') : (payload.tableName ?? 'TABLE'), 34);
        if (payload.zoneName)
            add(payload.zoneName);
        const cancelLabel = payload.cancelScope === 'ORDER' ? (ky ? 'БУЙРУТМА ТОЛУК ЖОККО ЧЫГАРЫЛДЫ' : 'ОТМЕНА ВСЕГО ЗАКАЗА') : payload.cancelScope === 'ITEM' ? (ky ? 'ТАМАКТЫ ЖОККО ЧЫГАРУУ' : 'ОТМЕНА БЛЮДА') : (ky ? 'ЖОККО ЧЫГАРУУ' : 'ОТМЕНА');
        add(purpose === 'CANCEL' ? cancelLabel : purpose === 'CHANGE_COMMENT' ? (ky ? 'ӨЗГӨРТҮҮ' : 'ИЗМЕНЕНИЕ') : (ky ? 'БУЙРУТМА' : 'ЗАКАЗ'), 30);
    }
    else {
        add(payload.branchName || 'BASHKAR.KG', 30);
        add(payload.type === 'COUNTER' ? (ky ? 'АЛЫП КЕТҮҮ' : 'НА ВЫНОС') : (payload.tableName ?? 'TABLE'), 28);
        if (payload.zoneName) add(payload.zoneName);
    }
    if (payload.orderNumber ?? payload.counterNumber) add((ky ? 'Буйрутма №' : 'Заказ №') + String(payload.orderNumber ?? payload.counterNumber).padStart(3,'0'), 26);
    add(new Date(payload.settledAt ?? payload.submittedAt ?? payload.createdAt ?? now).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }));
    const sender = payload.sender ?? payload.actor;
    if (sender?.name) add((type === 'CUSTOMER' ? (ky ? 'Төлөмдү кабыл алган: ' : 'Оплату принял: ') : (ky ? 'Жөнөткөн: ' : 'Отправил: ')) + sender.name);
    if (type === 'KITCHEN' && payload.responsibleWaiter?.name && payload.responsibleWaiter.id !== sender?.id)
        add((ky ? 'Жооптуу: ' : 'Ответственный: ') + payload.responsibleWaiter.name);
    if (payload.reason)
        add((ky ? 'Себеби: ' : 'Причина: ') + payload.reason);
    for (const item of payload.lines ?? []) {
        add(`${item.quantity} × ${name(item)}`, 26);
        if (item.combination) add(name(item.combination));
        else {
        if (item.variant)
            add(name(item.variant));
        for (const m of item.modifiers ?? [])
            add((item.pricingMode === 'MATRIX' ? '' : '+ ') + name(m));
        }
        for(const component of item.components??[]){
            if(type==='KITCHEN'&&!component.kitchen)continue;
            add(`  ${component.quantity*item.quantity} × ${name(component)}`);
            if(component.combination)add('    '+name(component.combination));
            else{if(component.variant)add('    '+name(component.variant));for(const option of component.modifiers??[])add('    '+name(option));}
        }
        if (item.oldComment !== undefined && purpose === 'CHANGE_COMMENT')
            add((ky ? 'Мурда: ' : 'Было: ') + item.oldComment);
        if (type === 'KITCHEN' && item.comment)
            add((ky ? 'Белги: ' : 'Комментарий: ') + item.comment);
        if (type === 'CUSTOMER' && Number.isSafeInteger(item.total))
            add(money(item.total) + ' сом');
    }
    if (type === 'CUSTOMER') {
        add((ky ? 'Позициялар: ' : 'Подытог: ') + money(payload.subtotal ?? 0) + ' сом');
        add((ky ? 'Арзандатуу: ' : 'Скидка: ') + money(payload.discount ?? 0));
        for (const f of payload.fees ?? [])
            add(`${f.name}: ${money(f.amount)} сом`);
        add((ky ? 'ЖЫЙЫНТЫК: ' : 'ИТОГО: ') + money(payload.total ?? 0) + ' сом', 30);
        if (payload.financialState === 'ZERO_SETTLED')
            add(ky ? 'НӨЛДҮК ЭСЕПТЕШҮҮ' : 'НУЛЕВОЙ РАСЧЁТ', 30);
        for (const p of payload.payments ?? [])
            add(({ CASH: ky ? 'Накталай' : 'Наличные', CARD_MANUAL: ky ? 'Карта' : 'Карта', QR_TRANSFER_MANUAL: ky ? 'QR-которуу' : 'QR-перевод' } as any)[p.method] + ': ' + money(p.amount) + ' сом');
    }
    if (repeat)
        add((ky ? 'Кайталанган убакыт: ' : 'Время повтора: ') + new Date(now).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }));
    return lines;
}
export function renderReceipt(type: string, purpose: string, payload: unknown, profile: PrintProfile, repeat = false, now = Date.now()) {
    requireCondition(profile.width >= 384 && profile.width <= 608 && profile.width % 8 === 0 && profile.cutter === false && (profile.kitchenTextSize === undefined || ['NORMAL', 'LARGE'].includes(profile.kitchenTextSize)), 'INVALID_PRINT_PROFILE');
    const font = resolve('third-party/fonts/NotoSans-Regular.ttf'), options = { font: { fontFiles: [font], loadSystemFonts: false, defaultFontFamily: 'Noto Sans' }, background: 'white' }, margin = 16, width = profile.width;
    const wrapped: {
        text: string;
        size: number;
    }[] = [];
    const cache = new Map<string, number>();
    const measure = (text: string, size: number) => { const key = size + ':' + text; if (cache.has(key))
        return cache.get(key)!; const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="80"><text x="0" y="50" font-family="Noto Sans" font-size="${size}">${escape(text)}</text></svg>`; const n = new Resvg(svg, options).getBBox()?.width ?? 0; if (cache.size > 2048)
        cache.clear(); cache.set(key, n); return n; };
    const scale = type === 'KITCHEN' && profile.kitchenTextSize === 'LARGE' ? 1.25 : 1;
    for (const original of receiptLines(type, purpose, payload, repeat, now)) {
        const line = {...original, size: Math.round(original.size * scale)};
        for (const paragraph of line.text.split('\n')) {
            let chars = [...paragraph];
            if (!chars.length)
                wrapped.push({ ...line, text: '' });
            while (chars.length) {
                let lo = 1, hi = chars.length;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (measure(chars.slice(0, mid).join(''), line.size) <= width - 2 * margin)
                        lo = mid;
                    else
                        hi = mid - 1;
                }
                let count = lo;
                const chunk = chars.slice(0, count).join('');
                if (count < chars.length) {
                    const space = chunk.lastIndexOf(' ');
                    if (space > 0)
                        count = space + 1;
                }
                wrapped.push({ ...line, text: chars.splice(0, count).join('').trimEnd() });
                requireCondition(wrapped.length < 20000, 'PRINT_RENDER_LIMIT');
            }
        }
    }
    const chunks: Buffer[] = [Buffer.from([0x1b, 0x40])], pngs: Buffer[] = [];
    let group: typeof wrapped = [], height = 8, total = 0;
    const flush = () => {
        if (!group.length)
            return;
        let y = 8;
        const content = group.map(l => { y += l.size + 8; return `<text x="${margin}" y="${y}" font-family="Noto Sans" font-size="${l.size}">${escape(l.text)}</text>`; }).join('');
        const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 16}"><rect width="100%" height="100%" fill="white"/>${content}</svg>`, options).render();
        const rgba = image.pixels, w = image.width, h = image.height, bytes = w / 8, raster = Buffer.alloc(bytes * h);
        for (let yy = 0; yy < h; yy++)
            for (let x = 0; x < w; x++) {
                const offset = (yy * w + x) * 4;
                if (rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114 < 160)
                    raster[yy * bytes + (x >> 3)] |= 128 >> (x & 7);
            }
        const header = Buffer.from([0x1d, 0x76, 0x30, 0, bytes & 255, bytes >> 8, h & 255, h >> 8]);
        chunks.push(header, raster);
        total += raster.length;
        requireCondition(total <= 32 * 1024 * 1024, 'PRINT_RENDER_LIMIT');
        if (pngs.length === 0)
            pngs.push(image.asPng());
        group = [];
        height = 8;
    };
    for (const line of wrapped) {
        if (height + line.size + 8 > 768)
            flush();
        group.push(line);
        height += line.size + 8;
    }
    flush();
    chunks.push(Buffer.from([0x1b, 0x4a, Math.min(profile.feed, 96)]));
    const raw = Buffer.concat(chunks);
    return { raw, preview: pngs[0], hash: createHash('sha256').update(raw).digest('hex'), lineCount: wrapped.length };
}
export function renderInWorker(type: string, purpose: string, payload: unknown, profile: PrintProfile, repeat: boolean, now: number): Promise<{
    raw: Buffer;
    preview: Buffer;
    hash: string;
    lineCount: number;
}> { return new Promise((done, reject) => { const worker = new Worker(process.env.BASHKAR_PRINT_WORKER_ENTRY ?? __filename, { workerData: { type, purpose, payload, profile, repeat, now } }); const timer = setTimeout(() => { void worker.terminate(); reject(new Error('PRINT_RENDER_TIMEOUT')); }, 30000); worker.once('message', value => { clearTimeout(timer); if (value.error)
    reject(new Error(value.error));
else
    done({ ...value, raw: Buffer.from(value.raw), preview: Buffer.from(value.preview) }); }); worker.once('error', e => { clearTimeout(timer); reject(e); }); worker.once('exit', code => { clearTimeout(timer); if (code !== 0)
    reject(new Error('PRINT_RENDER_FAILED')); }); }); }
if (!isMainThread && workerData) {
    try {
        const d = workerData;
        parentPort!.postMessage(renderReceipt(d.type, d.purpose, d.payload, d.profile, d.repeat, d.now));
    }
    catch {
        parentPort!.postMessage({ error: 'PRINT_RENDER_FAILED' });
    }
}
