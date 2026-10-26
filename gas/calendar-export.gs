/**
 * スマートスケジュール帳：Googleカレンダーのバイト予定を書き出す Apps Script
 *
 * 【使い方】
 *  1. https://script.google.com で「新しいプロジェクト」を作り、このコードを貼り付けて保存する
 *  2. 下の CONFIG を自分のカレンダーに合わせて変更する
 *  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選び、
 *       次のユーザーとして実行：自分
 *       アクセスできるユーザー：全員
 *     でデプロイする（初回はカレンダーへのアクセス許可を求められるので「許可」する）
 *  4. 表示された「ウェブアプリのURL」（…/exec で終わるURL）をアプリの
 *     「📅 Googleカレンダー連携」欄に貼り付ける
 *
 * 【シフト表の画像からカレンダーへ書き込む場合】
 *  5. アプリの「📷 シフト表から登録」→ 設定 で「合言葉を作る」を押し、表示された文字列を
 *     下の CONFIG.WRITE_TOKEN に貼り付けて保存する
 *  6. 「デプロイを管理」→ 編集（鉛筆）→ バージョン「新バージョン」→「デプロイ」で更新する
 *     （カレンダーへの書き込み許可を改めて求められたら「許可」する）
 *
 * 【manaba の課題メール（Gmail）を取り込む場合】
 *  7. このコードに貼り替えたら「デプロイを管理」→ 編集 → バージョン「新バージョン」で更新する
 *     （Gmail を読む許可を求められるので「許可」する。読むのは MANABA_QUERY に合うメールだけ）
 *  8. 不要なら CONFIG.MANABA_ENABLED を false にする
 *  9. manaba の「提出のお知らせ」メールも読み、提出した課題をアプリで自動的に完了にする
 *     （manaba のリマインダ設定で、課題提出の通知をONにしておく）
 *
 * 【アプリを開かなくても届く通知（時間で自動実行）】
 * 10. このコードに貼り替えて保存し、上の関数の選択欄で「setupTriggers」を選んで「▶ 実行」する
 *     （メール送信・外部への接続・自動実行の許可を求められるので「許可」する）。
 *     これで次の3つが自動で動く。止めたいときは「removeTriggers」を実行する
 *       ・1時間ごと: manaba の課題の締切をカレンダーに「📩 締切：〜」として登録（提出したら ✅ に変える）
 *       ・1時間ごと: バイト開始の約1時間前に、24時間以内に締切の未提出課題があればメールで知らせる
 *       ・毎朝 MORNING_HOUR 時: 今日のバイトと締切が近い課題をまとめたメールを送る
 * 11. まとめメールに AI のひとことを付けたい場合は、「プロジェクトの設定（歯車）」→
 *     「スクリプト プロパティ」に GEMINI_API_KEY という名前で Gemini の APIキーを追加する
 *     （キーをコードに書かないこと）
 * 12. 試しにメールを受け取りたいときは「morningSummary」を選んで実行する
 * 13. doGet（アプリ用）の変更も反映するため、「デプロイを管理」→ 新バージョン で更新する
 *
 * 【注意】
 *  - URLを知っている人は、条件に合う予定（タイトルと時刻）を見られます。URLは人に教えないこと。
 *  - manaba の取り込みを有効にすると、URLを知っている人は「課題名・コース名・締切」も見られます。
 *  - 書き込みは合言葉が一致したときだけ行います。合言葉が空のままなら書き込みは無効です。
 *  - コードを変更したら「デプロイを管理」→ 編集 → バージョン「新バージョン」で更新する（URLは変わらない）。
 */

const CONFIG = {
  // バイト専用カレンダーがあれば、そのカレンダーID（設定 → カレンダーの統合 に表示）を入れる。
  // 空のままなら、メインのカレンダーを読む。
  CALENDAR_ID: '',

  // タイトルにどれかを含む予定だけを書き出す。
  // バイト専用カレンダーを使う場合は [] にすると、そのカレンダーの予定をすべて書き出す。
  KEYWORDS: ['バイト', 'アルバイト', 'シフト'],

  // 書き出す期間（今日から何日前〜何日後まで）
  DAYS_BACK: 7,
  DAYS_AHEAD: 62,   // 翌月分のシフトもすべて取り込めるように約2か月先まで

  // シフト表から予定を書き込むときの合言葉（アプリの設定と同じ文字列にする）。空なら書き込み無効
  WRITE_TOKEN: '',

  // manaba の「〇〇公開のお知らせ」メールから課題を読み取ってアプリに渡す
  MANABA_ENABLED: true,
  MANABA_QUERY: 'from:manaba subject:公開のお知らせ newer_than:45d',
  // 「〇〇提出のお知らせ」メール（提出した課題を完了にするため）
  MANABA_SUBMIT_QUERY: 'from:manaba subject:提出のお知らせ newer_than:45d',

  // ---- アプリを開かなくても届く通知（setupTriggers で有効にする） ----
  TIME_ZONE: 'Asia/Tokyo',
  NOTIFY_EMAIL: '',                     // 通知の送り先。空なら自分のアドレス
  DEADLINE_CALENDAR_ID: '',             // 締切の予定を入れるカレンダー。空ならメインのカレンダー
  DEADLINE_REMINDERS_MIN: [1440, 180],  // 締切の予定の通知（分前）：前日・3時間前
  MORNING_HOUR: 7,                      // まとめメールを送る時刻（時）
  SUMMARY_DAYS: 7,                      // まとめメールに載せる締切の範囲（日）
  JOB_REMINDER_MIN: 60,                 // バイト開始の何分前に知らせるか
  APP_URL: 'https://galaxynagi2006-lang.github.io/schedule-book/'
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DEADLINE_TAG = 'smartScheduleDeadline';   // このスクリプトが作った締切の予定につける目印

function getCalendar() {
  return CONFIG.CALENDAR_ID
    ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();
}

/**
 * バイトの予定を取り出す（タイトルの KEYWORDS で判定。このスクリプトが作った締切の予定は除く）
 * 返す形: [{ id, title, start: Date, end: Date }]
 */
function getJobEvents(calendar, from, to) {
  return calendar.getEvents(from, to)
    .filter(event => !event.isAllDayEvent())
    .filter(event => !event.getTag(DEADLINE_TAG))
    .filter(event => CONFIG.KEYWORDS.length === 0 || CONFIG.KEYWORDS.some(word => event.getTitle().includes(word)))
    .map(event => ({
      // 繰り返し予定は同じIDを共有するため、開始時刻と組み合わせて1回ごとに区別する
      id: `${event.getId()}_${event.getStartTime().getTime()}`,
      title: event.getTitle(),
      start: event.getStartTime(),
      end: event.getEndTime()
    }));
}

function doGet() {
  const calendar = getCalendar();

  if (!calendar) {
    return toJson({ error: 'カレンダーが見つかりません。CALENDAR_ID を確認してください。' });
  }

  const now = new Date();
  const from = new Date(now.getTime() - CONFIG.DAYS_BACK * DAY);
  const to = new Date(now.getTime() + CONFIG.DAYS_AHEAD * DAY);

  const events = getJobEvents(calendar, from, to).map(job => ({
    id: job.id,
    title: job.title,
    start: job.start.toISOString(),
    end: job.end.toISOString()
  }));

  const result = {
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: now.toISOString(),
    events
  };

  if (CONFIG.MANABA_ENABLED) {
    try {
      result.assignments = getManabaAssignments();
      result.submissions = getManabaSubmissions();
    } catch (err) {
      // Gmail の許可がないときなど。カレンダーの予定は返せるようにする
      result.assignmentsError = String(err && err.message || err);
    }
  }

  return toJson(result);
}

/**
 * manaba のお知らせメールから課題の一覧を作る
 * 返す形: [{ id, kind, course, title, deadline: "2026-10-21 00:00:00", url, receivedAt }]
 * 同じ課題のメールが何通かあれば、新しいメールの内容を使う
 */
function getManabaAssignments() {
  const byId = {};
  GmailApp.search(CONFIG.MANABA_QUERY, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      const parsed = parseManabaMail(message.getPlainBody());
      if (!parsed) return;
      const receivedAt = message.getDate().toISOString();
      const previous = byId[parsed.id];
      if (!previous || previous.receivedAt < receivedAt) {
        byId[parsed.id] = Object.assign(parsed, { receivedAt });
      }
    });
  });
  return Object.keys(byId).map(id => byId[id]);
}

/**
 * メール本文の「[コース名] : 〜」「[課題名] : 〜」「[受付終了日時] : 〜」を読み取る
 * （レポート以外の小テストなどでも使えるよう、項目名は少しゆるく探す）
 */
function readManabaFields(body) {
  const fields = {};
  String(body).split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*[\[［]([^\]］]+)[\]］]\s*[:：]\s*(.+?)\s*$/);
    if (match) fields[match[1].trim()] = match[2];
  });
  return fields;
}

function findManabaUrl(body) {
  const match = String(body).match(/https:\/\/[^\s]*manaba\.jp\/ct\/course_[^\s]+/);
  return match ? match[0] : '';
}

function parseManabaMail(body) {
  const fields = readManabaFields(body);

  const titleKey = ['課題名', 'タイトル'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /名$/.test(key) && key !== 'コース名');
  const deadlineKey = ['受付終了日時', '締切日時', '締め切り日時'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /終了|締切|締め切り/.test(key));
  if (!titleKey || !deadlineKey) return null;

  const deadline = fields[deadlineKey].replace(/\//g, '-');
  if (!/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}/.test(deadline)) return null;

  const kindMatch = String(body).match(/--\s*(.+?)情報\s*--/);
  const url = findManabaUrl(body);
  const title = fields[titleKey].replace(/\s+/g, ' ');
  const course = (fields['コース名'] || '').replace(/\s+/g, ' ');

  return {
    // 課題ごとのURL（course_〇〇_report_〇〇）を重複防止の目印にする
    id: url ? `manaba_${url.split('/ct/')[1]}` : `manaba_${course}_${title}_${deadline}`,
    kind: kindMatch ? kindMatch[1].trim() : '課題',
    course,
    title,
    deadline,
    url
  };
}

/**
 * manaba の「提出のお知らせ」メールから、提出した課題の一覧を作る
 * 返す形: [{ id, course, title, submittedAt }]（本文に提出日時がないため、受信日時を提出日時とする）
 */
function getManabaSubmissions() {
  const byId = {};
  GmailApp.search(CONFIG.MANABA_SUBMIT_QUERY, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      const parsed = parseManabaSubmission(message.getPlainBody());
      if (!parsed) return;
      const submittedAt = message.getDate().toISOString();
      const previous = byId[parsed.id];
      if (!previous || previous.submittedAt < submittedAt) {   // 再提出したときは最後の提出
        byId[parsed.id] = Object.assign(parsed, { submittedAt });
      }
    });
  });
  return Object.keys(byId).map(id => byId[id]);
}

function parseManabaSubmission(body) {
  if (!/提出されました/.test(String(body))) return null;
  const fields = readManabaFields(body);
  const url = findManabaUrl(body);
  const titleKey = ['課題名', 'タイトル'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /名$/.test(key) && key !== 'コース名');
  if (!url && !titleKey) return null;
  const title = titleKey ? fields[titleKey].replace(/\s+/g, ' ') : '';
  const course = (fields['コース名'] || '').replace(/\s+/g, ' ');
  return {
    // 公開のお知らせと同じ目印（課題URL）で結び付ける
    id: url ? `manaba_${url.split('/ct/')[1]}` : '',
    course,
    title
  };
}

/**
 * シフトをカレンダーに書き込む
 * 受け取る形: { token, title, shifts: [{ start: ISO文字列, end: ISO文字列 }, ...] }
 * 同じタイトル・同じ開始/終了時刻の予定がすでにあれば作らない（二重登録防止）
 */
function doPost(e) {
  let request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return toJson({ error: '送られたデータを読み取れません' });
  }

  if (!CONFIG.WRITE_TOKEN || request.token !== CONFIG.WRITE_TOKEN) {
    return toJson({ error: '合言葉が一致しません（Apps Script の WRITE_TOKEN を確認）' });
  }

  const calendar = getCalendar();
  if (!calendar) {
    return toJson({ error: 'カレンダーが見つかりません。CALENDAR_ID を確認してください。' });
  }

  const title = String(request.title || 'バイト');
  const shifts = Array.isArray(request.shifts) ? request.shifts : [];
  let created = 0;
  let skipped = 0;

  shifts.forEach(shift => {
    const start = new Date(shift.start);
    const end = new Date(shift.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      skipped++;
      return;
    }
    const exists = calendar.getEvents(start, end).some(event =>
      event.getTitle() === title &&
      event.getStartTime().getTime() === start.getTime() &&
      event.getEndTime().getTime() === end.getTime()
    );
    if (exists) {
      skipped++;
      return;
    }
    calendar.createEvent(title, start, end);
    created++;
  });

  return toJson({ created, skipped });
}

// =====================================================================
// アプリを開かなくても届く通知（時間主導型トリガーで自動実行）
// =====================================================================

/** 自動実行を設定する（一度だけ実行すればよい。何度実行しても重複しない） */
function setupTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('hourlyUpdate').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('morningSummary').timeBased().everyDays(1)
    .atHour(CONFIG.MORNING_HOUR).nearMinute(0).inTimezone(CONFIG.TIME_ZONE).create();
  hourlyUpdate();   // すぐに1回動かして、締切の予定を登録しておく
  console.log(`自動実行を設定しました（1時間ごと・毎朝${CONFIG.MORNING_HOUR}時）`);
}

/** 自動実行を止める */
function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['hourlyUpdate', 'morningSummary'].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

/** 1時間ごと：締切の予定を更新し、バイト前の確認メールを送る */
function hourlyUpdate(arg) {
  const now = arg instanceof Date ? arg : new Date();   // トリガーからは別の値が渡るので現在時刻を使う
  const manaba = loadManabaStatus(now);
  syncDeadlineEvents(manaba.all, now);
  remindBeforeJobs(manaba.pending, now);
}

/** 毎朝：今日のバイトと、締切が近い未提出の課題をまとめて送る */
function morningSummary(arg) {
  const now = arg instanceof Date ? arg : new Date();
  const calendar = getCalendar();
  const todayStart = startOfDay(now);
  const jobsToday = getJobEvents(calendar, todayStart, new Date(todayStart.getTime() + DAY));
  const jobsTomorrow = getJobEvents(calendar, new Date(todayStart.getTime() + DAY), new Date(todayStart.getTime() + 2 * DAY));
  const pending = loadManabaStatus(now).pending
    .filter(a => a.deadlineDate.getTime() - now.getTime() <= CONFIG.SUMMARY_DAYS * DAY);

  const message = buildMorningSummary({ now, jobsToday, jobsTomorrow, pending, advice: '', format: formatDate });
  const advice = getAiAdvice(message.body);
  const finalMessage = advice
    ? buildMorningSummary({ now, jobsToday, jobsTomorrow, pending, advice, format: formatDate })
    : message;
  sendNotice(finalMessage.subject, finalMessage.body);
}

// ---------- manaba の課題の状況 ----------

/** 課題メールと提出メールから、全課題（提出済みかどうか付き）と締切前の未提出課題を作る */
function loadManabaStatus(now) {
  return computeManabaStatus(getManabaAssignments(), getManabaSubmissions(), now);
}

function computeManabaStatus(assignments, submissions, now) {
  const submittedIds = new Set(submissions.map(s => s.id).filter(Boolean));
  const submittedNames = new Set(submissions.map(s => `${s.course}：${s.title}`));
  const all = assignments
    .map(a => Object.assign({}, a, {
      deadlineDate: parseManabaDate(a.deadline),
      submitted: submittedIds.has(a.id) || submittedNames.has(`${a.course}：${a.title}`)
    }))
    .filter(a => a.deadlineDate);
  const pending = all
    .filter(a => !a.submitted && a.deadlineDate > now)
    .sort((x, y) => x.deadlineDate - y.deadlineDate);
  return { all, pending };
}

/** manaba の日時 "2026-10-21 00:00:00"（日本時間）を Date にする */
function parseManabaDate(text) {
  const m = String(text || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const p = n => String(n).padStart(2, '0');
  return new Date(`${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:00+09:00`);
}

// ---------- ① 締切をカレンダーに登録 ----------

function deadlineEventTitle(a) {
  return `${a.submitted ? '✅ 提出済み' : '📩 締切'}：${a.title}（${a.course}）`;
}

/**
 * 締切前の課題を「📩 締切：〜」の予定として登録し、提出したら「✅ 提出済み：〜」に変えて通知を消す。
 * 予定は締切の30分前〜締切。目印（タグ）で見分けるので、二重に作らない
 */
function syncDeadlineEvents(all, now) {
  const calendar = CONFIG.DEADLINE_CALENDAR_ID
    ? CalendarApp.getCalendarById(CONFIG.DEADLINE_CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();
  const existing = {};
  calendar.getEvents(new Date(now.getTime() - 3 * DAY), new Date(now.getTime() + 120 * DAY)).forEach(event => {
    const id = event.getTag(DEADLINE_TAG);
    if (id) existing[id] = event;
  });

  all.forEach(a => {
    const title = deadlineEventTitle(a);
    const start = new Date(a.deadlineDate.getTime() - 30 * MINUTE);
    const event = existing[a.id];
    if (event) {
      if (event.getTitle() !== title) {
        event.setTitle(title);
        if (a.submitted) event.removeAllReminders();   // 提出したら通知しない
      }
      if (event.getEndTime().getTime() !== a.deadlineDate.getTime()) {
        event.setTime(start, a.deadlineDate);   // 締切の延長など
      }
      return;
    }
    if (a.submitted || a.deadlineDate <= now) return;   // 提出済み・締切後の課題は新しく作らない

    const created = calendar.createEvent(title, start, a.deadlineDate, {
      description: `${a.course}\n${a.url || ''}\n（スマートスケジュール帳が自動で登録した予定です）`
    });
    created.setTag(DEADLINE_TAG, a.id);
    created.removeAllReminders();
    CONFIG.DEADLINE_REMINDERS_MIN.forEach(minutes => created.addPopupReminder(minutes));
  });
}

// ---------- ③ バイト前の確認 ----------

/** バイト開始の約 JOB_REMINDER_MIN 分前に、24時間以内に締切の未提出課題があれば知らせる（1回のバイトにつき1通） */
function remindBeforeJobs(pending, now) {
  const props = PropertiesService.getScriptProperties();
  let notified = {};
  try {
    notified = JSON.parse(props.getProperty('notifiedJobs') || '{}');
  } catch (e) {
    notified = {};
  }

  const jobs = getJobEvents(getCalendar(), now, new Date(now.getTime() + 3 * HOUR));
  // 1時間ごとの実行は時刻が少しずれるので、前後に余裕を持たせて探す（同じバイトには1回だけ送る）
  findJobsStartingSoon(jobs, now, CONFIG.JOB_REMINDER_MIN - 40, CONFIG.JOB_REMINDER_MIN + 40).forEach(job => {
    if (notified[job.id]) return;
    const urgent = pending.filter(a => a.deadlineDate.getTime() - now.getTime() <= DAY);
    if (urgent.length > 0) {
      const message = buildJobReminder(job, urgent, now, formatDate);
      sendNotice(message.subject, message.body);
    }
    notified[job.id] = job.start.toISOString();
  });

  // 2日以上前の記録は消す
  Object.keys(notified).forEach(id => {
    if (new Date(notified[id]).getTime() < now.getTime() - 2 * DAY) delete notified[id];
  });
  props.setProperty('notifiedJobs', JSON.stringify(notified));
}

function findJobsStartingSoon(jobs, now, fromMinutes, toMinutes) {
  return jobs.filter(job => {
    const minutesUntil = (job.start.getTime() - now.getTime()) / MINUTE;
    return minutesUntil >= fromMinutes && minutesUntil < toMinutes;
  });
}

// ---------- メールの文面 ----------

function formatDate(date, pattern) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, pattern);
}

function startOfDay(date) {
  return parseManabaDate(`${formatDate(date, 'yyyy-MM-dd')} 00:00`);
}

const WEEKDAY_NAMES = ['', '月', '火', '水', '木', '金', '土', '日'];   // 'u' は 1=月〜7=日

function dayLabel(date, format) {
  return `${format(date, 'M/d')}（${WEEKDAY_NAMES[Number(format(date, 'u'))]}）`;
}

function remainingLabel(deadline, now) {
  const minutes = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / MINUTE));
  if (minutes >= 1440) return `あと${Math.floor(minutes / 1440)}日${Math.floor((minutes % 1440) / 60)}時間`;
  return `あと${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function assignmentLine(a, now, format) {
  const mark = a.deadlineDate.getTime() - now.getTime() <= DAY ? '🚨' : '・';
  return `${mark} ${format(a.deadlineDate, 'M/d HH:mm')} まで（${remainingLabel(a.deadlineDate, now)}）　${a.title}［${a.course}］`;
}

function jobLine(job, format) {
  return `${format(job.start, 'HH:mm')}〜${format(job.end, 'HH:mm')}　${job.title}`;
}

function buildMorningSummary({ now, jobsToday, jobsTomorrow, pending, advice, format }) {
  const lines = [
    `おはようございます。${dayLabel(now, format)}の予定です。`,
    '',
    '■ 今日のバイト',
    ...(jobsToday.length > 0 ? jobsToday.map(job => `  ${jobLine(job, format)}`) : ['  なし']),
    `■ 明日のバイト：${jobsTomorrow.length > 0 ? jobsTomorrow.map(job => jobLine(job, format)).join(' ／ ') : 'なし'}`,
    '',
    `■ 締切が近い課題（${CONFIG.SUMMARY_DAYS}日以内・未提出 ${pending.length}件）`,
    ...(pending.length > 0 ? pending.map(a => `  ${assignmentLine(a, now, format)}`) : ['  なし']),
  ];
  if (advice) lines.push('', `💡 ひとこと：${advice}`);
  lines.push('', `アプリで開く：${CONFIG.APP_URL}`);

  const urgentCount = pending.filter(a => a.deadlineDate.getTime() - now.getTime() <= DAY).length;
  const subject = `【今日の予定】${dayLabel(now, format)} バイト${jobsToday.length > 0 ? 'あり' : 'なし'}・締切${pending.length}件` +
    (urgentCount > 0 ? `（24時間以内 ${urgentCount}件）` : '');
  return { subject, body: lines.join('\n') };
}

function buildJobReminder(job, urgent, now, format) {
  const lines = [
    `${format(job.start, 'HH:mm')}から「${job.title}」です（${format(job.start, 'HH:mm')}〜${format(job.end, 'HH:mm')}）。`,
    'バイトの前に、24時間以内に締切の未提出課題を確認しておきましょう。',
    '',
    ...urgent.map(a => `  ${assignmentLine(a, now, format)}`),
    '',
    `アプリで開く：${CONFIG.APP_URL}`
  ];
  return {
    subject: `【バイト前の確認】${format(job.start, 'HH:mm')}からバイト・締切が近い課題${urgent.length}件`,
    body: lines.join('\n')
  };
}

// ---------- ② AI のひとこと（スクリプト プロパティに GEMINI_API_KEY があるときだけ） ----------

function getAiAdvice(summaryText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return '';
  const prompt = '以下は、授業とアルバイトを両立している大学生の今日の予定と、締切が近い課題です。' +
    '今日いちばん優先してやるべきことを1つに絞り、60文字以内の日本語で1文だけアドバイスしてください。' +
    '前置きや説明は不要です。\n\n' + summaryText;
  try {
    const response = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      console.warn('AIのひとことを取得できませんでした', response.getResponseCode(), response.getContentText().slice(0, 200));
      return '';
    }
    const data = JSON.parse(response.getContentText());
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    return parts.map(part => part.text || '').join('').trim().replace(/\s+/g, ' ').slice(0, 120);
  } catch (err) {
    console.warn('AIのひとことでエラー', err);
    return '';
  }
}

function sendNotice(subject, body) {
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail(),
    subject,
    body,
    name: 'スマートスケジュール帳'
  });
}

function toJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
