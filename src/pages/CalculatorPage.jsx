import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, format } from '../utils/calc';
import { useToasts } from '../stores';

const HISTORY_KEY = 'buddy.calc.history';
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } };
const saveHistory = (h) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* storage unavailable */ } };

const KEYS = [
  ['C', '(', ')', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['±', '0', '.', '='],
];
const EXTRA = ['√(', '^', '%', '⌫'];
const OPS = new Set(['÷', '×', '−', '+', '^']);

export default function CalculatorPage() {
  const toast = useToasts((s) => s.push);
  const [expr, setExpr] = useState('');
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);

  // Live preview of the result while typing; errors only show on "=".
  const preview = useMemo(() => {
    try { return expr && !justEvaluated ? format(evaluate(expr)) : ''; } catch { return ''; }
  }, [expr, justEvaluated]);

  function equals() {
    if (!expr) return;
    try {
      const result = format(evaluate(expr));
      const h = [{ expr, result }, ...history.filter((x) => x.expr !== expr)].slice(0, 30);
      setHistory(h);
      saveHistory(h);
      setExpr(result);
      setError(null);
      setJustEvaluated(true);
    } catch (err) {
      setError(err.message);
    }
  }

  function press(k) {
    setError(null);
    if (k === '=') { equals(); return; }
    if (k === 'C') { setExpr(''); setJustEvaluated(false); return; }
    if (k === '⌫') { setExpr((e) => (justEvaluated ? '' : e.slice(0, -1))); setJustEvaluated(false); return; }
    if (k === '±') { setExpr((e) => (e.startsWith('-(') && e.endsWith(')') ? e.slice(2, -1) : e ? `-(${e})` : '-')); setJustEvaluated(false); return; }
    setExpr((e) => {
      // After "=", typing a digit starts fresh; typing an operator continues from the result.
      const base = justEvaluated && !OPS.has(k) && k !== '%' ? '' : e;
      return base + k;
    });
    setJustEvaluated(false);
  }

  function onKeyDown(e) {
    const map = { '*': '×', '/': '÷', '-': '−', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'C' };
    const k = map[e.key] ?? (/^[0-9.+()^%]$/.test(e.key) ? e.key : null);
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && expr) {
      e.preventDefault();
      navigator.clipboard.writeText(preview || expr).then(() => toast('Copied'), () => {});
      return;
    }
    if (!k || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    press(k);
  }

  const btn = (k) => {
    const cls = k === '=' ? 'bg-brand-500 text-stone-950 hover:bg-brand-400'
      : OPS.has(k) || k === 'C' ? 'bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600'
        : 'bg-white hover:bg-stone-100 dark:bg-stone-800 dark:hover:bg-stone-700';
    return (
      <button key={k} type="button" onClick={() => { press(k); ref.current?.focus(); }}
        className={`h-14 rounded-xl text-lg font-semibold shadow-sm transition-colors ${cls}`}
        aria-label={{ C: 'Clear', '⌫': 'Backspace', '±': 'Negate', '√(': 'Square root', '÷': 'Divide', '×': 'Multiply', '−': 'Minus', '^': 'Power', '%': 'Percent' }[k] || k}>
        {k === '√(' ? '√' : k === '^' ? 'xʸ' : k}
      </button>
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-wrap gap-6 p-6">
      <div ref={ref} tabIndex={0} onKeyDown={onKeyDown} className="card w-80 shrink-0 p-4 outline-none" aria-label="Calculator. Type numbers and operators, Enter to calculate.">
        <h1 className="mb-3 text-xl font-bold">Calculator</h1>
        <div className="mb-3 rounded-xl bg-stone-100 px-4 py-3 text-right dark:bg-stone-950" aria-live="polite">
          <div className="min-h-6 break-all font-mono text-sm text-stone-500">{justEvaluated ? '' : expr || ' '}</div>
          <div className={`break-all font-mono text-3xl font-bold ${error ? 'text-red-600 text-lg' : ''}`}>
            {error || (justEvaluated ? expr : preview || expr || '0')}
          </div>
        </div>
        <div className="mb-2 grid grid-cols-4 gap-2">{EXTRA.map(btn)}</div>
        <div className="grid grid-cols-4 gap-2">{KEYS.flat().map(btn)}</div>
        <p className="mt-3 text-xs text-stone-500">Keyboard works too: Enter =, Esc clears, Ctrl+C copies.</p>
      </div>

      <section className="min-w-56 flex-1" aria-label="History">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label">History</h2>
          {history.length > 0 && <button type="button" className="btn-ghost py-0.5 text-xs" onClick={() => { setHistory([]); saveHistory([]); }}>Clear</button>}
        </div>
        <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
          {history.map((h) => (
            <li key={h.expr}>
              <button type="button" className="w-full px-3 py-2 text-right hover:bg-stone-50 dark:hover:bg-stone-800"
                onClick={() => { setExpr(h.expr); setJustEvaluated(false); setError(null); ref.current?.focus(); }} title="Use this calculation again">
                <span className="block font-mono text-xs text-stone-500">{h.expr}</span>
                <span className="block font-mono font-semibold">= {h.result}</span>
              </button>
            </li>
          ))}
          {!history.length && <li className="px-3 py-6 text-center text-sm text-stone-500">No calculations yet</li>}
        </ul>
      </section>
    </div>
  );
}
