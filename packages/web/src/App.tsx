import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { type Route, useRoute } from './router';
import { CreateRoom } from './screens/CreateRoom';
import { Home } from './screens/Home';
import { JoinRoom } from './screens/JoinRoom';
import { RolesPage } from './screens/RolesPage';
import { RoomScreen } from './screens/RoomScreen';

function screenFor(route: Route): { key: string; node: ReactNode } {
  switch (route.name) {
    case 'home':
      return { key: 'home', node: <Home /> };
    case 'create':
      return { key: 'create', node: <CreateRoom /> };
    case 'join':
      return { key: 'join', node: <JoinRoom initialCode={route.code} /> };
    case 'roles':
      return { key: 'roles', node: <RolesPage /> };
    case 'room':
      return { key: `room-${route.code}`, node: <RoomScreen code={route.code} /> };
  }
}

export function App() {
  const route = useRoute();
  const screen = screenFor(route);
  return (
    <div className="scene-bg grain min-h-dvh">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={screen.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="min-h-dvh"
        >
          {screen.node}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Колонка экрана: на телефоне — во всю ширину, на большом экране — по центру. */
export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 ${className}`}>{children}</div>;
}
