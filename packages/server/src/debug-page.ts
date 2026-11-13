/**
 * Отладочная страница: один HTML-файл без стилей и анимаций, чтобы проверить сервер руками.
 * Каждая вкладка браузера — отдельный игрок (токен хранится в sessionStorage вкладки).
 *
 * Скрипт страницы написан без шаблонных строк: весь файл — одна сырая строка TypeScript.
 */
export const DEBUG_PAGE = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Мафия: отладка</title>
</head>
<body>
<h1>Мафия Online — отладочная страница</h1>
<p>Страница без оформления: только проверка сервера. Каждая вкладка — отдельный игрок. Откройте ссылку комнаты в нескольких вкладках.</p>

<div id="entry">
  <fieldset>
    <legend>Создать комнату</legend>
    <label>Имя <input id="c-name" value="Хост" maxlength="20"></label>
    <label>Пароль <input id="c-pass" value="1234" maxlength="64"></label>
    <label>Хост <select id="c-mode"><option value="player">играет</option><option value="narrator">ведущий-наблюдатель</option></select></label>
    <button data-act="create">Создать</button>
  </fieldset>
  <fieldset>
    <legend>Войти в комнату</legend>
    <label>Код <input id="j-code" maxlength="6" size="7"></label>
    <label>Имя <input id="j-name" maxlength="20"></label>
    <label>Пароль <input id="j-pass" value="1234" maxlength="64"></label>
    <button data-act="join">Войти</button>
  </fieldset>
</div>

<p id="status"></p>
<div id="app" hidden>
  <div id="room"></div>
  <hr>
  <div id="game"></div>
  <hr>
  <h3>Журнал событий (в вашей видимости)</h3>
  <ol id="events"></ol>
  <details><summary>Сырые сообщения сервера</summary><pre id="raw"></pre></details>
</div>

<script>
var PROTOCOL = 1;
var S = { code: null, ws: null, me: null, room: null, game: null, events: [], scenes: [], chat: [], nextId: 1, raw: [] };

function $(id) { return document.getElementById(id); }
function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function status(text) { $('status').textContent = text; }
function tokenKey(code) { return 'mafia-token:' + code; }
function nameOf(id) {
  if (id === null || id === undefined) return '—';
  var list = (S.game && S.game.view.players) || (S.room && S.room.members) || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
  return id;
}
function names(ids) { return ids.map(nameOf).join(', '); }
function isHost() { return S.room && S.room.hostId === S.me; }

function connect(code, hello) {
  S.code = code;
  var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/rooms/' + code + '/ws');
  S.ws = ws;
  status('Подключение к комнате ' + code + '…');
  ws.onopen = function () { ws.send(JSON.stringify(Object.assign({ t: 'hello', v: PROTOCOL }, hello))); };
  ws.onmessage = function (e) { if (e.data !== 'pong') onMessage(JSON.parse(e.data), e.data); };
  ws.onclose = function (e) {
    status('Соединение закрыто (' + e.code + (e.reason ? ', ' + e.reason : '') + '). Обновите страницу, чтобы переподключиться.');
    if (e.code === 4000 || e.code === 4001 || e.code === 4003) sessionStorage.removeItem(tokenKey(code));
  };
  // раз в 25 секунд — «ping»: сервер отвечает, не просыпаясь
  setInterval(function () { if (ws.readyState === 1) ws.send('ping'); }, 25000);
}

function send(message) {
  if (!S.ws || S.ws.readyState !== 1) { status('Нет соединения'); return; }
  message.id = S.nextId++;
  S.ws.send(JSON.stringify(message));
}

function onMessage(m, raw) {
  S.raw.push(raw);
  if (S.raw.length > 200) S.raw.shift();
  if (m.t === 'welcome') {
    S.me = m.memberId;
    if (m.token) sessionStorage.setItem(tokenKey(S.code), m.token);
    S.room = m.room; S.game = m.game; S.events = m.history.slice(); S.scenes = m.scenes.slice(); S.chat = m.chat.slice();
    history.replaceState(null, '', '/api/debug?r=' + S.code);
    $('entry').hidden = true; $('app').hidden = false;
    status('Вы в комнате ' + S.code + ' как ' + nameOf(S.me) + ' (' + S.me + '). Ссылка: ' + location.origin + '/api/debug?r=' + S.code);
  } else if (m.t === 'room') {
    S.room = m.room;
    if (m.room.stage === 'lobby') { S.game = null; S.events = []; S.scenes = []; S.chat = []; }
  } else if (m.t === 'game') {
    S.game = m.game; S.events = S.events.concat(m.events); S.scenes = S.scenes.concat(m.scenes);
  } else if (m.t === 'chat') {
    S.chat.push(m.message);
  } else if (m.t === 'error') {
    status('Ошибка ' + m.code + ': ' + m.message);
  } else if (m.t === 'bye') {
    status('Сервер закрыл соединение: ' + m.message);
  }
  render();
}

function options(ids, withNone) {
  var html = withNone ? '<option value="">(' + esc(withNone) + ')</option>' : '';
  for (var i = 0; i < ids.length; i++) html += '<option value="' + esc(ids[i]) + '">' + esc(nameOf(ids[i])) + '</option>';
  return html;
}

function renderRoom() {
  var r = S.room, html = '';
  html += '<h2>Комната ' + esc(r.code) + ' — ' + esc(r.stage) + '</h2><ul>';
  for (var i = 0; i < r.members.length; i++) {
    var m = r.members[i];
    html += '<li>' + esc(m.name) + ' (' + esc(m.id) + ')' + (m.isHost ? ' — хост' : '') + (m.online ? '' : ' — не в сети') + (m.playing ? '' : ' — не играет') + (m.id === S.me ? ' — это вы' : '');
    if (isHost() && m.id !== S.me) {
      html += ' <button data-act="transfer" data-id="' + esc(m.id) + '">сделать хостом</button>';
      if (r.stage !== 'game') html += ' <button data-act="kick" data-id="' + esc(m.id) + '">исключить</button>';
    }
    html += '</li>';
  }
  html += '</ul>';
  html += '<p>Режим показа: ' + esc(r.settings.display) + '; хост: ' + esc(r.settings.hostMode) + '; таймеры: ' + esc(JSON.stringify(r.settings.timers)) + (r.presetHidden ? '; состав задан хостом вручную (скрыт)' : '') + '</p>';
  if (r.startIssues.length) html += '<p>Начать нельзя: ' + esc(r.startIssues.join('; ')) + '</p>';
  if (r.startWarnings.length) html += '<p>Предупреждения: ' + esc(r.startWarnings.join('; ')) + '</p>';
  if (isHost() && r.stage === 'lobby') {
    html += '<p><button data-act="start">Начать игру</button></p>';
    html += '<p><label>Изменение настроек (JSON): <br><textarea id="patch" rows="3" cols="70">{"display":"open","timers":{"night":60}}</textarea></label><br><button data-act="settings">Применить</button></p>';
  }
  if (isHost() && r.stage !== 'lobby') html += '<p><button data-act="toLobby">Вернуть всех в лобби</button></p>';
  if (r.stage !== 'game') html += '<p><button data-act="leave">Выйти из комнаты</button></p>';
  html += '<details><summary>Все настройки</summary><pre>' + esc(JSON.stringify(r.settings, null, 2)) + '</pre></details>';
  $('room').innerHTML = html;
}

function renderGame() {
  var g = S.game;
  if (!g) { $('game').innerHTML = '<p>Партия не идёт.</p>'; return; }
  var v = g.view, html = '';
  html += '<h2>Партия: ' + esc(g.stage) + ', круг ' + v.round + ', шаг ' + g.step + '</h2>';
  html += '<p>' + (g.progress ? 'Прогресс: ' + g.progress.done + ' из ' + g.progress.total + '. ' : '') + (g.deadline ? 'До конца стадии: ' + Math.max(0, Math.round((g.deadline - g.serverTime) / 1000)) + ' с. ' : 'Таймера нет. ') + (v.waitingForDecision ? 'Игра ждёт чьего-то решения.' : '') + '</p>';
  if (v.you) html += '<p>Вы: <b>' + esc(v.you.role) + '</b> (' + esc(v.you.team) + '), ' + (v.you.alive ? 'живы' : 'мертвы') + (v.you.silenced ? ', молчите сегодня' : '') + (v.you.lovers.length ? ', влюблены в: ' + esc(names(v.you.lovers)) : '') + '</p>';
  else html += '<p>Вы ведущий-наблюдатель: видите все роли и все действия.</p>';
  if (g.composition) html += '<p>Состав партии: ' + esc(g.composition.map(function (c) { return c.role + (c.count > 1 ? ' ×' + c.count : ''); }).join(', ')) + '</p>';

  html += '<table border="1" cellpadding="3"><tr><th>Игрок</th><th>Жив</th><th>Роль</th><th>Примечания</th></tr>';
  for (var i = 0; i < v.players.length; i++) {
    var p = v.players[i];
    html += '<tr><td>' + esc(p.name) + '</td><td>' + (p.alive ? 'да' : 'нет' + (p.deathCause ? ' (' + esc(p.deathCause) + ')' : '')) + '</td><td>' + esc(p.role || '?') + '</td><td>' + (p.silenced ? 'молчит ' : '') + (p.lover ? 'ваша пара ' : '') + '</td></tr>';
  }
  html += '</table>';

  if (g.stage === 'night' && v.night && v.night.options) {
    var o = v.night.options;
    html += '<h3>Ваш ночной ход</h3><p>Отправлено: ' + esc(JSON.stringify(v.night.submitted)) + (v.night.teamVotes ? '; голоса команды: ' + esc(JSON.stringify(v.night.teamVotes)) : '') + '</p>';
    for (var a = 0; a < o.abilities.length; a++) {
      var ab = o.abilities[a];
      html += '<p>' + esc(ab.id) + (ab.usesLeft !== null ? ' (осталось ' + ab.usesLeft + ')' : '') + ': <select id="ab-' + a + '-0">' + options(ab.candidates) + '</select>';
      if (ab.targets === 2) html += ' и <select id="ab-' + a + '-1">' + options(ab.candidates) + '</select>';
      html += ' <button data-act="ability" data-index="' + a + '" data-ability="' + esc(ab.id) + '" data-targets="' + ab.targets + '">Применить</button></p>';
    }
    if (o.mafiaVote) html += '<p>Голос мафии: <select id="mafia-vote">' + options(o.mafiaVote.candidates, 'воздержаться') + '</select> <button data-act="mafiaVote">Проголосовать</button></p>';
    html += '<p><button data-act="pass">' + (o.abilities.length ? 'Не применять способность' : 'Сделать «пустой» ход') + '</button></p>';
  }
  if (g.stage === 'morning') html += '<h3>Утро: итоги ночи</h3><p><button data-act="ready">Готов к началу дня</button></p>';
  if (g.stage === 'evening') html += '<h3>Вечер: приговор</h3><p><button data-act="ready">Готов к началу ночи</button></p>';
  if (v.backstage) html += '<h3>Закулисье (видит только ведущий)</h3><pre>' + esc(JSON.stringify(v.backstage, null, 2)) + '</pre>';
  if (g.stage === 'discussion') html += '<h3>Обсуждение: голоса пока не принимаются</h3>' + (isHost() ? '<p><button data-act="advance">Начать голосование</button></p>' : '<p>Голосование начнёт хост.</p>');
  if (g.stage === 'day' && v.day) {
    var pool = (v.day.candidates || v.players.filter(function (x) { return x.alive; }).map(function (x) { return x.id; })).filter(function (id) { return id !== S.me; });
    html += '<h3>Голосование' + (v.day.stage === 'revote' ? ' (переголосование)' : '') + '</h3><p>Проголосовали: ' + esc(names(v.day.voted)) + '. Ваш голос: ' + esc(v.day.myVote === undefined ? 'ещё нет' : nameOf(v.day.myVote)) + (v.day.ballots ? '. Все голоса: ' + esc(JSON.stringify(v.day.ballots)) : '') + '</p>';
    if (v.day.canVote) html += '<p><select id="vote">' + options(pool, 'воздержаться') + '</select> <button data-act="vote">Проголосовать</button></p>';
  }
  if (v.decision) {
    html += '<h3>От вас ждут решения: ' + esc(v.decision.kind) + '</h3>';
    if (v.decision.kind === 'judgeVeto') html += '<p>Приговорён: ' + esc(nameOf(v.decision.condemned)) + '. <button data-act="veto" data-veto="1">Отменить казнь</button> <button data-act="veto" data-veto="0">Не отменять</button></p>';
    else html += '<p><select id="decision">' + options(v.decision.options, v.decision.kind === 'hunterShot' ? 'не стрелять' : null) + '</select> <button data-act="decision" data-kind="' + esc(v.decision.kind) + '">Подтвердить</button></p>';
  }
  if (isHost() && g.stage !== 'ended' && g.stage !== 'discussion') html += '<p><button data-act="advance">Хост: дальше (не ждать остальных)</button></p>';
  if (v.result) html += '<h3>Итог: ' + esc(v.result.outcome) + ' (' + esc(v.result.reason) + ')</h3><p>Победители: ' + esc(names(v.result.winners)) + '</p>';

  if ((v.you && v.you.team === 'black') || v.backstage) {
    html += '<h3>Чат мафии</h3><ul>';
    for (var c = 0; c < S.chat.length; c++) html += '<li>[круг ' + S.chat[c].round + '] ' + esc(S.chat[c].name) + ': ' + esc(S.chat[c].text) + '</li>';
    html += '</ul>';
    if (v.you) html += '<p><input id="chat-text" maxlength="300" size="50"> <button data-act="chat">Отправить</button></p>';
  }
  if (S.scenes.length) {
    html += '<h3>Кто на вас подействовал («Кино»)</h3><ul>';
    for (var s = 0; s < S.scenes.length; s++) html += '<li>круг ' + S.scenes[s].round + ': ' + esc(S.scenes[s].role) + ' применил ' + esc(S.scenes[s].ability) + (S.scenes[s].saved ? ' — это вас спасло' : '') + '</li>';
    html += '</ul>';
  }
  $('game').innerHTML = html;
}

function render() {
  // запоминаем выбранное в списках, чтобы перерисовка его не сбрасывала
  var keep = {}, fields = document.querySelectorAll('#app select, #app input, #app textarea');
  for (var i = 0; i < fields.length; i++) if (fields[i].id) keep[fields[i].id] = fields[i].value;
  if (S.room) renderRoom();
  renderGame();
  for (var id in keep) { var el = $(id); if (el && keep[id] !== '' ) { el.value = keep[id]; } }
  var list = '';
  for (var e = 0; e < S.events.length; e++) {
    var ev = S.events[e];
    list += '<li value="' + ev.id + '">[' + esc(ev.phase) + ' ' + ev.round + '] <b>' + esc(ev.type) + '</b>' + (ev.actors.length ? ' кто: ' + esc(names(ev.actors)) : '') + (ev.targets.length ? ' кого: ' + esc(names(ev.targets)) : '') + ' ' + esc(JSON.stringify(ev.data)) + (ev.redacted ? ' <i>(скрытный вид)</i>' : '') + '</li>';
  }
  $('events').innerHTML = list;
  $('raw').textContent = S.raw.slice(-40).join('\n\n');
}

document.addEventListener('click', function (event) {
  var el = event.target;
  if (!el || !el.getAttribute) return;
  var act = el.getAttribute('data-act');
  if (!act) return;
  if (act === 'create') {
    fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('c-name').value, password: $('c-pass').value, hostMode: $('c-mode').value }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.error) { status('Ошибка ' + d.error.code + ': ' + d.error.message); return; } connect(d.code, { token: d.token }); });
  } else if (act === 'join') {
    connect($('j-code').value.trim().toUpperCase(), { name: $('j-name').value, password: $('j-pass').value });
  } else if (act === 'start' || act === 'leave' || act === 'toLobby') {
    send({ t: act });
  } else if (act === 'kick') {
    send({ t: 'kick', memberId: el.getAttribute('data-id') });
  } else if (act === 'transfer') {
    send({ t: 'transferHost', memberId: el.getAttribute('data-id') });
  } else if (act === 'settings') {
    try { send({ t: 'settings', patch: JSON.parse($('patch').value) }); } catch (e) { status('Это не JSON: ' + e.message); }
  } else if (act === 'ability') {
    var index = el.getAttribute('data-index'), targets = [$('ab-' + index + '-0').value];
    if (el.getAttribute('data-targets') === '2') targets.push($('ab-' + index + '-1').value);
    send({ t: 'night', action: { kind: 'ability', ability: el.getAttribute('data-ability'), targets: targets } });
  } else if (act === 'mafiaVote') {
    send({ t: 'night', action: { kind: 'mafiaVote', target: $('mafia-vote').value || null } });
  } else if (act === 'pass') {
    send({ t: 'night', action: { kind: 'pass' } });
  } else if (act === 'ready') {
    send({ t: 'ready', step: S.game.step });
  } else if (act === 'advance') {
    send({ t: 'advance', step: S.game.step });
  } else if (act === 'vote') {
    send({ t: 'vote', target: $('vote').value || null });
  } else if (act === 'veto') {
    send({ t: 'decision', decision: { kind: 'judgeVeto', veto: el.getAttribute('data-veto') === '1' } });
  } else if (act === 'decision') {
    send({ t: 'decision', decision: { kind: el.getAttribute('data-kind'), target: $('decision').value || null } });
  } else if (act === 'chat') {
    send({ t: 'chat', text: $('chat-text').value });
    $('chat-text').value = '';
  }
});

// ссылка вида /api/debug?r=КОД: подставляем код и, если во вкладке есть токен, переподключаемся
(function () {
  var match = /[?&]r=([^&]+)/.exec(location.search);
  if (!match) return;
  var code = decodeURIComponent(match[1]).toUpperCase();
  $('j-code').value = code;
  var token = sessionStorage.getItem(tokenKey(code));
  if (token) connect(code, { token: token });
  else status('Комната ' + code + ': введите имя и пароль.');
})();
</script>
</body>
</html>
`;
