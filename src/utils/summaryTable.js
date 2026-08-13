/**
 * Renderiza los items procesados como una tabla ASCII.
 * Usa SOLO caracteres ASCII (+, -, |) — nada de box-drawing ni emojis — para que
 * se vea bien en terminales de Windows/Git Bash sin problemas de codificación.
 *
 * @param {Array<Object>} items  summary.preview (itemCode, description, case, plannedStock, plannedUnitCost)
 * @returns {string}
 */
function renderProcessedTable(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return '  (sin items procesados)';
    }

    const fmt = (n) => (Number(n) || 0).toFixed(2);
    const truncate = (s, w) => {
        s = String(s == null ? '' : s);
        return s.length > w ? s.slice(0, w - 3) + '...' : s;
    };
    const pad = (s, w, align) => {
        s = truncate(s, w);
        const space = w - s.length;
        if (align === 'right') return ' '.repeat(space) + s;
        if (align === 'center') {
            const left = Math.floor(space / 2);
            return ' '.repeat(left) + s + ' '.repeat(space - left);
        }
        return s + ' '.repeat(space);
    };

    const cols = [
        { h: 'Codigo',      w: 11, a: 'left',   g: (it) => it.itemCode },
        { h: 'Descripcion', w: 26, a: 'left',   g: (it) => it.description },
        { h: 'Caso',        w: 4,  a: 'center', g: (it) => it.case },
        { h: 'Stock',       w: 10, a: 'right',  g: (it) => fmt(it.plannedStock) },
        { h: 'Costo',       w: 10, a: 'right',  g: (it) => fmt(it.plannedUnitCost) },
    ];

    const sep = '+' + cols.map((c) => '-'.repeat(c.w + 2)).join('+') + '+';
    const row = (cell) => '|' + cols.map((c) => ' ' + pad(cell(c), c.w, c.a) + ' ').join('|') + '|';

    const lines = [sep, row((c) => c.h), sep];
    for (const it of items) lines.push(row((c) => c.g(it)));
    lines.push(sep);
    return lines.join('\n');
}

module.exports = { renderProcessedTable };
