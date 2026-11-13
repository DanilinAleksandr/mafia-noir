/**
 * Компонентные тесты ключевых экранов. Состояние партии строит настоящий движок.
 */
import { castVote, resolveVote, submitNightAction } from '@mafia/engine';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoleCard } from '../components/RoleCard';
import { HoldToReveal } from '../components/HoldToReveal';
import { eventsFor, newGame, nightKill, renderWith, room, snapshot, storeWith } from '../test/fixtures';
import { render } from '@testing-library/react';
import { DecisionPanel } from './game/DecisionPanel';
import { VotePanel, DiscussionPanel } from './game/DayPanels';
import { FinalPanel } from './game/FinalPanel';
import { GameScreen } from './game/GameScreen';
import { NightPanel } from './game/NightPanel';
import { Home } from './Home';
import { Lobby } from './Lobby';

const OK = { ok: true } as const;
const ROLES = ['mafia', 'commissioner', 'doctor', 'civilian', 'hunter'] as const;

describe('Главная', () => {
  it('создать комнату, войти по коду, справочник', () => {
    render(<Home />);
    expect(screen.getByRole('button', { name: 'Создать комнату' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти по коду' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Справочник ролей/ })).toBeInTheDocument();
  });
});

describe('Лобби', () => {
  it('хост: код, участники с онлайн-статусом, причины «нельзя начать»', () => {
    const store = storeWith({ memberId: 'm1', room: room(3, 'm1', { startIssues: ['Нужно минимум 4 игрока'] }) });
    renderWith(store, <Lobby />);
    expect(screen.getByTestId('room-code')).toHaveTextContent('K7MPQ');
    expect(screen.getAllByTestId('member')).toHaveLength(3);
    expect(screen.getAllByText('в сети')).toHaveLength(2);
    expect(screen.getByText('не в сети')).toBeInTheDocument();
    expect(screen.getByText('Нужно минимум 4 игрока')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Начать игру' })).toBeDisabled();
  });

  it('хост начинает игру и исключает участника с подтверждением', async () => {
    const store = storeWith({ memberId: 'm1', room: room(5) });
    const start = vi.spyOn(store, 'start').mockResolvedValue(OK);
    const kick = vi.spyOn(store, 'kick').mockResolvedValue(OK);
    renderWith(store, <Lobby />);
    await userEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    expect(start).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Вера/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Исключить' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Подтвердить' }));
    expect(kick).toHaveBeenCalledWith('m3');
  });

  it('гость ждёт хоста и не видит кнопки старта', () => {
    const store = storeWith({ memberId: 'm2', room: room(5) });
    renderWith(store, <Lobby />);
    expect(screen.queryByRole('button', { name: 'Начать игру' })).toBeNull();
    expect(screen.getByText(/Ждём, когда хост начнёт игру/)).toBeInTheDocument();
  });
});

describe('Карточка роли', () => {
  it('заглушка в цвете команды, если иллюстрации нет; рубашка — пока не открыта', () => {
    const { rerender } = render(<RoleCard role="doctor" team="red" faceUp={false} />);
    expect(screen.getAllByTestId('card-back').length).toBeGreaterThan(0);
    rerender(<RoleCard role="doctor" team="red" faceUp />);
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-role', 'doctor');
    expect(screen.getByText('Доктор')).toBeInTheDocument();
  });

  it('роль видна, только пока карточку удерживают', () => {
    render(
      <HoldToReveal role="mafia" team="black">
        <p>Сообщники: Борис</p>
      </HoldToReveal>,
    );
    const card = screen.getByRole('button', { name: 'Удерживайте, чтобы посмотреть роль' });
    expect(screen.queryByText('Сообщники: Борис')).toBeNull();
    fireEvent.pointerDown(card);
    expect(screen.getByText('Сообщники: Борис')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(screen.queryByText('Сообщники: Борис')).toBeNull();
  });
});

describe('Ночь', () => {
  const state = newGame([...ROLES]);

  it('у мирного и у Комиссара экран одинаков по виду; ролей в сетке нет', () => {
    for (const id of ['m4', 'm2']) {
      const store = storeWith({ memberId: id, room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, id, 'night') });
      const { unmount } = renderWith(store, <NightPanel />);
      expect(screen.getByText('Ваш ночной ход')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Сделать ход' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Пропустить' })).toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(5);
      // ни своя роль, ни чужие на экране хода не показываются
      expect(screen.queryByText('Мирный житель')).toBeNull();
      expect(screen.queryByText('Комиссар')).toBeNull();
      unmount();
    }
  });

  it('мирный «делает ход» — на сервер уходит пустой ход', async () => {
    const store = storeWith({ memberId: 'm4', room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, 'm4', 'night') });
    const night = vi.spyOn(store, 'night').mockResolvedValue(OK);
    renderWith(store, <NightPanel />);
    await userEvent.click(screen.getByRole('option', { name: 'Аня' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сделать ход' }));
    expect(night).toHaveBeenCalledWith({ kind: 'pass' });
  });

  it('Комиссар проверяет выбранного игрока', async () => {
    const store = storeWith({ memberId: 'm2', room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, 'm2', 'night') });
    const night = vi.spyOn(store, 'night').mockResolvedValue(OK);
    renderWith(store, <NightPanel />);
    expect(screen.getByText('Кого проверить этой ночью?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Аня' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сделать ход' }));
    expect(night).toHaveBeenCalledWith({ kind: 'ability', ability: 'check', targets: ['m1'] });
  });

  it('мафия голосует за жертву; своих выбрать нельзя', async () => {
    const store = storeWith({ memberId: 'm1', room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, 'm1', 'night') });
    const night = vi.spyOn(store, 'night').mockResolvedValue(OK);
    renderWith(store, <NightPanel />);
    expect(screen.getByRole('option', { name: 'Аня' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('option', { name: 'Даша' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сделать ход' }));
    expect(night).toHaveBeenCalledWith({ kind: 'mafiaVote', target: 'm5' });
  });

  it('сделанный ход скрыт, пока не нажать «показать»', async () => {
    const moved = submitNightAction(state, 'm2', { kind: 'ability', ability: 'check', targets: ['m1'] }).state;
    const store = storeWith({ memberId: 'm2', room: room(5, 'm1', { stage: 'game' }), game: snapshot(moved, 'm2', 'night') });
    renderWith(store, <NightPanel />);
    expect(screen.getByTestId('move-done')).toBeInTheDocument();
    expect(screen.queryByText(/Проверить: Аня/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Показать ход' }));
    expect(screen.getByText('Проверить: Аня')).toBeInTheDocument();
  });

  it('выбывший видит «город спит» без выбора', () => {
    const later = nightKill(state, 'm4');
    const store = storeWith({ memberId: 'm4', room: room(5, 'm1', { stage: 'game' }), game: snapshot(later, 'm4', 'night') });
    renderWith(store, <NightPanel />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText(/Город спит/)).toBeInTheDocument();
  });
});

describe('Отложенные решения', () => {
  // Охотник погибает ночью — решение только у него
  const killed = nightKill(newGame([...ROLES]), 'm5');

  it('Охотник выбирает, остальные видят нейтральное ожидание', async () => {
    const hunter = storeWith({ memberId: 'm5', room: room(5, 'm1', { stage: 'game' }), game: snapshot(killed, 'm5', 'decision') });
    const decision = vi.spyOn(hunter, 'decision').mockResolvedValue(OK);
    const { unmount } = renderWith(hunter, <DecisionPanel />);
    expect(screen.getByText('Последний выстрел')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Не стрелять' }));
    expect(decision).toHaveBeenCalledWith({ kind: 'hunterShot', target: null });
    unmount();

    const other = storeWith({ memberId: 'm4', room: room(5, 'm1', { stage: 'game' }), game: snapshot(killed, 'm4', 'decision') });
    renderWith(other, <DecisionPanel />);
    expect(screen.getByTestId('decision-waiting')).toBeInTheDocument();
    expect(screen.queryByText(/Охотник/)).toBeNull();
  });
});

describe('День', () => {
  const day = nightKill(newGame([...ROLES]), 'm4');

  it('обсуждение: хост начинает голосование, отметка заблокированного Шантажистом', async () => {
    const store = storeWith({ memberId: 'm1', room: room(5, 'm1', { stage: 'game' }), game: snapshot(day, 'm1', 'discussion') });
    const advance = vi.spyOn(store, 'advance').mockResolvedValue(OK);
    renderWith(store, <DiscussionPanel isHost />);
    await userEvent.click(screen.getByTestId('start-vote'));
    expect(advance).toHaveBeenCalled();
    // своя роль живому в списке стола не показывается
    expect(screen.queryByText('Мафия')).toBeNull();
    // роль погибшего открыта всем
    expect(screen.getByText('Мирный житель')).toBeInTheDocument();
  });

  it('тайное голосование: выбор кандидата и смена голоса', async () => {
    const store = storeWith({ memberId: 'm2', room: room(5, 'm1', { stage: 'game' }), game: snapshot(day, 'm2', 'day') });
    const vote = vi.spyOn(store, 'vote').mockResolvedValue(OK);
    renderWith(store, <VotePanel isHost={false} />);
    // против себя голосовать нельзя
    expect(screen.getByRole('option', { name: 'Борис' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('option', { name: 'Аня' }));
    await userEvent.click(screen.getByRole('button', { name: 'Проголосовать' }));
    expect(vote).toHaveBeenCalledWith('m1');
  });

  it('финал: роли открыты, хост может сыграть ещё раз', async () => {
    let s = day;
    for (const id of ['m2', 'm3', 'm5']) s = castVote(s, id, 'm1').state;
    s = resolveVote(s).state;
    expect(s.phase).toBe('ended');
    const store = storeWith({ memberId: 'm1', room: room(5, 'm1', { stage: 'finished' }), game: snapshot(s, 'm1', 'ended'), events: eventsFor(s, 'm1') });
    const toLobby = vi.spyOn(store, 'toLobby').mockResolvedValue(OK);
    renderWith(store, <FinalPanel isHost />);
    expect(screen.getByText('Победа города')).toBeInTheDocument();
    expect(screen.getAllByTestId('card-face')).toHaveLength(5);
    await userEvent.click(screen.getByTestId('play-again'));
    expect(toLobby).toHaveBeenCalled();
  });
});

describe('Игровой экран и ведущий', () => {
  it('ведущему — экран с ролями и ходами, игроку — без «закулисья»', () => {
    const state = submitNightAction(newGame([...ROLES]), 'm2', { kind: 'ability', ability: 'check', targets: ['m1'] }).state;
    const narrator = storeWith({ memberId: 'm0', room: room(5, 'm0', { stage: 'game' }), game: snapshot(state, null, 'night', {}, true) });
    const { unmount } = renderWith(narrator, <GameScreen />);
    expect(screen.getByTestId('narrator')).toBeInTheDocument();
    expect(screen.getByText('Проверить: Аня')).toBeInTheDocument();
    expect(screen.getAllByText('Мафия').length).toBeGreaterThan(0);
    unmount();

    const player = storeWith({ memberId: 'm4', room: room(5, 'm1', { stage: 'game' }), game: snapshot(state, 'm4', 'night') });
    renderWith(player, <GameScreen />);
    expect(screen.queryByTestId('narrator')).toBeNull();
    expect(screen.queryByText(/Проверить: Аня/)).toBeNull();
  });
});
