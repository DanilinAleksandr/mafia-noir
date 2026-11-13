/**
 * Экран комнаты: вход (по токену или имени и паролю), состояние соединения, лобби или партия.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Screen } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Spinner, ToastView } from '../components/ui';
import { t } from '../i18n';
import { ApiError, roomInfo } from '../net/api';
import { takePendingJoin } from '../net/pending';
import { forgetSession, sessionFor } from '../net/session';
import { navigate } from '../router';
import { RoomStoreProvider, useRoomState, useStore } from '../store/context';
import { RoomStore } from '../store/roomStore';
import { GameScreen } from './game/GameScreen';
import { JoinForm } from './JoinRoom';
import { Lobby } from './Lobby';

/** Ошибки входа по имени и паролю: показываются в форме входа. */
const JOIN_ERRORS = new Set([
  'WRONG_PASSWORD',
  'NAME_TAKEN',
  'BAD_NAME',
  'BAD_PASSWORD',
  'ROOM_FULL',
  'ROOM_STARTED',
  'TOO_MANY_ATTEMPTS',
  'ROOM_BUSY',
  'BAD_TOKEN',
]);

export function RoomScreen({ code }: { code: string }) {
  const store = useMemo(() => new RoomStore(code), [code]);
  const [mode, setMode] = useState<'form' | 'room'>(() => (sessionFor(code) ? 'room' : 'form'));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const join = takePendingJoin(code);
    const session = sessionFor(code);
    if (join) {
      store.connect({ name: join.name, password: join.password });
      setMode('room');
    } else if (session) {
      store.connect({ token: session.token });
      setMode('room');
    }
    return () => store.disconnect();
  }, [code, store]);

  return (
    <RoomStoreProvider store={store}>
      {mode === 'form' ? (
        <Screen className="safe-bottom">
          <TopBar title={t.entry.joinTitle} onBack={() => navigate('/')} />
          <div className="mt-4 flex flex-1 flex-col">
            <JoinForm
              fixedCode={code}
              initialError={formError}
              onJoin={(join) => {
                setFormError(null);
                store.connect({ name: join.name, password: join.password });
                setMode('room');
              }}
            />
          </div>
        </Screen>
      ) : (
        <RoomBody
          onJoinError={(message) => {
            store.disconnect();
            setFormError(message);
            setMode('form');
          }}
        />
      )}
    </RoomStoreProvider>
  );
}

function RoomBody({ onJoinError }: { onJoinError: (message: string) => void }) {
  const store = useStore();
  const state = useRoomState();
  const { status, close, room } = state;

  // ошибка входа — обратно в форму
  useEffect(() => {
    if (status === 'closed' && close && JOIN_ERRORS.has(close.code)) {
      if (close.code === 'BAD_TOKEN') forgetSession(state.code);
      onJoinError(close.message);
    }
  }, [status, close, onJoinError, state.code]);

  // сокет не открывается — возможно, комнаты уже нет
  useEffect(() => {
    if (status !== 'reconnecting' && !(status === 'connecting' && !room)) return;
    const timer = setTimeout(async () => {
      try {
        await roomInfo(state.code);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'ROOM_NOT_FOUND') store.markGone();
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [status, room, state.code, store]);

  if (status === 'closed' && close && !JOIN_ERRORS.has(close.code)) return <Closed />;
  if (!room) {
    return (
      <Screen className="items-center justify-center gap-4">
        <Spinner className="h-8 w-8" />
        <p className="text-muted">{status === 'reconnecting' ? t.connection.reconnecting : t.connection.connecting}</p>
      </Screen>
    );
  }

  return (
    <>
      <AnimatePresence>
        {status === 'reconnecting' ? (
          <motion.div
            role="status"
            initial={{ y: -40 }}
            animate={{ y: 0 }}
            exit={{ y: -40 }}
            className="safe-top fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-wine-700/95 px-3 pb-2 text-sm"
          >
            <Spinner className="h-4 w-4" /> {t.connection.reconnecting}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {room.stage === 'lobby' ? <Lobby /> : <GameScreen />}
      <ToastView toast={state.toast} />
    </>
  );
}

function Closed() {
  const store = useStore();
  const { close, code } = useRoomState();
  if (!close) return null;
  const replaced = close.code === 'REPLACED';
  const text =
    close.code === 'REPLACED'
      ? t.connection.replaced
      : close.code === 'KICKED'
        ? t.connection.kicked
        : close.code === 'LEFT'
          ? t.connection.left
          : close.code === 'ROOM_CLOSED'
            ? t.connection.closed
            : close.message;
  return (
    <Screen className="items-center justify-center gap-6 text-center">
      <p className="font-display text-2xl leading-snug">{text}</p>
      <div className="w-full space-y-3">
        {replaced ? (
          <>
            <Button
              block
              size="lg"
              onClick={() => {
                const session = sessionFor(code);
                if (session) store.connect({ token: session.token });
              }}
            >
              {t.connection.playHere}
            </Button>
            <Button
              tone="quiet"
              block
              onClick={() => {
                forgetSession(code);
                window.location.reload();
              }}
            >
              {t.connection.another}
            </Button>
          </>
        ) : (
          <Button block size="lg" onClick={() => navigate('/')}>
            {t.connection.home}
          </Button>
        )}
      </div>
    </Screen>
  );
}
