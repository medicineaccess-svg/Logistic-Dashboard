import { Check } from 'lucide-react';
import { STAGES, stageIndex, type Stage } from '../lib/constants';
import { cx } from './ui';

export function StageProgress({ stage }: { stage: Stage }) {
  const current = stageIndex(stage);
  return (
    <ol className="flex w-full items-start overflow-x-auto pb-1" aria-label="Shipment progress">
      {STAGES.map((s, i) => {
        const done = i < current || (i === current && s === 'POD received');
        const active = i === current;
        return (
          <li key={s} className="flex min-w-[78px] flex-1 flex-col items-center text-center" aria-current={active ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <div className={cx('h-0.5 flex-1', i === 0 ? 'bg-transparent' : i <= current ? 'bg-ok/60' : 'bg-line')} />
              <div
                className={cx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-all duration-300',
                  done && 'border-ok bg-ok text-white',
                  active && !done && 'border-marigold bg-marigold text-aubergine ring-4 ring-marigold/25',
                  !done && !active && 'border-line bg-white text-muted/70',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div className={cx('h-0.5 flex-1', i === STAGES.length - 1 ? 'bg-transparent' : i < current ? 'bg-ok/60' : 'bg-line')} />
            </div>
            <span className={cx('mt-1.5 px-0.5 text-[11px] leading-tight', active ? 'font-semibold text-navy-800' : done ? 'text-ink' : 'text-muted/70')}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}
