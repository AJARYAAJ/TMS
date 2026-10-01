import { ArrowUpRight, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { useCan } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { ALL_FEATURES, Feature, FEATURE_GROUPS, resolveFeaturePath } from './features';

/** Explore: every capability in one place, searchable, one click away. */
export default function ExplorePage() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const isAdmin = useCan('ADMIN');
  const setPalette = useUiStore((s) => s.setCommandPalette);
  const setShortcuts = useUiStore((s) => s.setShortcuts);
  const mark = useUiStore((s) => s.markOnboarding);
  useEffect(() => mark('explore'), [mark]);
  const project = projects?.find((p) => p.status === 'ACTIVE')?.key;
  const match = (f: Feature) => (!f.role || f.role !== 'ADMIN' || isAdmin) && (!q || `${f.name} ${f.blurb} ${f.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const go = (f: Feature) => {
    if (f.to === '#palette') return setPalette(true);
    if (f.to === '#shortcuts') return setShortcuts(true);
    navigate(resolveFeaturePath(f.to, project));
  };
  const fresh = ALL_FEATURES.filter((f) => f.isNew && match(f));

  return (
    <div className="page explore-page">
      <header className="explore-hero">
        <span className="eyebrow">Everything Workora can do</span>
        <h1 className="display">
          Explore<span className="ink-volt">.</span>
        </h1>
        <label className="explore-search">
          <Search size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a feature — “burndown”, “forms”, “import”…" aria-label="Find a feature" />
        </label>
      </header>

      {!q && fresh.length > 0 && (
        <section className="explore-new">
          <h2>
            <Sparkles size={16} /> New in Workora
          </h2>
          <div className="explore-strip">
            {fresh.map((f) => (
              <button key={f.id} className="explore-new-card" onClick={() => go(f)}>
                <span className="explore-icon">{f.icon}</span>
                <strong>{f.name}</strong>
                <span className="small">{f.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {FEATURE_GROUPS.map((g) => {
        const items = g.features.filter(match);
        if (!items.length) return null;
        return (
          <section key={g.title} className="explore-group">
            <div className="explore-group-head">
              <h2>{g.title}</h2>
              <span className="muted">{g.tagline}</span>
            </div>
            <div className="explore-grid">
              {items.map((f) => (
                <button key={f.id} className="explore-card" onClick={() => go(f)} data-feature={f.id}>
                  <span className="explore-icon">{f.icon}</span>
                  <span className="explore-text">
                    <strong>
                      {f.name} {f.isNew && <span className="new-dot">new</span>}
                    </strong>
                    <span className="muted small">{f.blurb}</span>
                  </span>
                  <ArrowUpRight size={15} className="explore-go" />
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {q && !ALL_FEATURES.some(match) && <p className="muted">Nothing matches “{q}”. Try Ctrl/⌘ K to search tasks and docs.</p>}
    </div>
  );
}
