import { motion } from 'framer-motion';
import { Screen } from '../App';
import { RoleCard } from '../components/RoleCard';
import { IconBook } from '../components/icons';
import { Button, Ornament } from '../components/ui';
import { t } from '../i18n';
import { lastSession } from '../net/session';
import { navigate } from '../router';

const FAN = [
  { role: 'civilian', team: 'red', rotate: -16, x: -70 },
  { role: 'mafia', team: 'black', rotate: 0, x: 0 },
  { role: 'maniac', team: 'neutral', rotate: 16, x: 70 },
] as const;

export function Home() {
  const resume = lastSession();
  return (
    <Screen className="safe-top safe-bottom justify-between">
      <header className="pt-10 text-center">
        <p className="text-[11px] font-bold tracking-[0.5em] text-gold-400/80 uppercase">Online</p>
        <h1 className="gold-text font-display text-[64px] leading-none font-bold tracking-wide">{t.appName.toUpperCase()}</h1>
        <p className="mt-3 font-display text-lg text-paper/75 italic">{t.tagline}</p>
      </header>

      <div className="relative mx-auto my-6 h-[230px] w-full" aria-hidden>
        {FAN.map((card, i) => (
          <motion.div
            key={card.role}
            className="absolute top-2 left-1/2"
            style={{ marginLeft: -64, zIndex: i === 1 ? 2 : 1 }}
            initial={{ y: 40, opacity: 0, rotate: 0, x: 0 }}
            animate={{ y: i === 1 ? -6 : 8, opacity: 1, rotate: card.rotate, x: card.x }}
            transition={{ delay: 0.15 + i * 0.08, duration: 0.7, ease: [0.22, 0.8, 0.2, 1] }}
          >
            <RoleCard role={card.role} team={card.team} faceUp={i !== 1} width={128} />
          </motion.div>
        ))}
      </div>

      <nav className="space-y-3 pb-4">
        {resume ? (
          <Button tone="ghost" block size="lg" onClick={() => navigate(`/r/${resume.code}`)}>
            {t.home.resume(resume.code)}
          </Button>
        ) : null}
        <Button block size="lg" onClick={() => navigate('/create')}>
          {t.home.create}
        </Button>
        <Button tone="wine" block size="lg" onClick={() => navigate('/join')}>
          {t.home.join}
        </Button>
        <Button tone="quiet" block onClick={() => navigate('/roles')}>
          <IconBook size={18} /> {t.home.rules}
        </Button>
        <Ornament className="pt-3" />
        <p className="text-center text-xs text-faint">{t.home.footer}</p>
      </nav>
    </Screen>
  );
}
