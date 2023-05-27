const os = require("os");
const puppeteer = require("puppeteer");
const moment = require("moment");
const applyConsoleStamp = require("console-stamp");
const { sendMessageViaBot, setBotCommand } = require("./telegram-bot");

applyConsoleStamp(console);

const MACCABI_URL =
  "https://maccabitickets.co.il/he-IL/subscriptions/%D7%9E%D7%9B%D7%91%D7%99%20playtika%20%D7%AA%D7%9C%20%D7%90%D7%91%D7%99%D7%91%202023-24?hallmap";
const PAGE_LOADED_SELECTOR = "#selectedAreaInfo .menu .area-info-container";
const AVAILABLE_SEATS_COMMAND =
  "Array.from(document.querySelectorAll('#selectedAreaInfo .menu .area-info-container')).map(node => ({ area: node.querySelector('h3.name').innerText, amount: parseInt(node.querySelector('.availSeats span.amount').innerText) }))";
const INTERVAL_TIME_MS = 15 * 1000; // 30 seconds
const THROTTLE_ALERT_TIME_MINUTES = 5; // 5 minutes
const THROTTLE_ALERT_TIME_MS = THROTTLE_ALERT_TIME_MINUTES * 60 * 1000; // 5 minutes
const THROTTLE_MAX_ALERTS = 3;
const TRACKED_AREAS = ["יציע 5", "יציע 6", "יציע 11", "יציע 12"];
const MAX_ERRORS_BEFORE_RESTART = 100;
const LAST_ERRORS_COUNT = 5;

const startupTime = new Date();
let totalSuccessfulRuns = 0;
let totalFailedRuns = 0;
const failedRunsErrors = [];
let lastTimeAlertSent = null;
let currentAlertCount = 0;

async function initBrowser() {
  console.log("Starting browser.. ");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    // In mac M1, for some reason, puppeteer doesn't install chromium by default, so we give chrome as an executable
    executablePath:
      process.env.IS_MAC !== "true"
        ? null
        : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  console.log("Starting browser.. DONE!");

  return browser;
}

async function initPage(browser) {
  console.log("Entering initPage, creating context and page.. ");
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  await page.setCacheEnabled(false);

  console.log("Loading target page.. ");
  await page.goto(MACCABI_URL);

  console.log("Waiting for selector to show.. ");
  await page.waitForSelector(PAGE_LOADED_SELECTOR);
  console.log("Waiting for selector to show.. DONE!");

  return { context, page };
}

async function getAllFreeSeats(page) {
  console.log(`Evaluating command "${AVAILABLE_SEATS_COMMAND}"`);
  let allFreeSeats = await page.evaluate(AVAILABLE_SEATS_COMMAND);

  allFreeSeats = allFreeSeats.map((originalDetails) => {
    return {
      area: originalDetails.area.replace("באזור ", "").replace(" .", ""),
      amount: originalDetails.amount,
    };
  });

  return allFreeSeats;
}

async function sendAlertIfNeeded(allFreeSeats, options = {}) {
  const sendMessageOptions = {};
  if (!shouldSendAlert(allFreeSeats, options)) {
    return;
  }

  const isAnyTrackedFreeSeatFound = getIsAnyTrackedFreeSeatFound(allFreeSeats);
  const isUpperGate5Available = allFreeSeats.some((areaDetails) =>
    getIsSameArea("יציע 5", areaDetails.area)
  );

  let title = "*סטטוס מקום ביציעים*\n";

  if (isUpperGate5Available) {
    title = "*מקום ביציע 5 התפנה!*\n";
  } else if (isAnyTrackedFreeSeatFound) {
    title = "*מקום באיזור מבוקש התפנה!*\n";
  }

  if (isUpperGate5Available || isAnyTrackedFreeSeatFound) {
    sendMessageOptions.withMentions = true;
    sendMessageOptions.withAlertTag = true;
    title += "\n═════════════════════════════\n\n";
  }

  let body = title;
  TRACKED_AREAS.forEach((trackedArea) => {
    const areaResult = allFreeSeats.find((freeAreaDetails) =>
      getIsSameArea(trackedArea, freeAreaDetails.area)
    );
    const amount = areaResult?.amount ?? 0;
    body += ` • *${trackedArea}* - ${amount} מקומות.\n`;
  });

  if (options.withFullStatus) {
    let allFreeSeatsHumanized = "";
    Object.values(allFreeSeats).forEach((areaDetails) => {
      allFreeSeatsHumanized += ` • _${areaDetails.area} - ${areaDetails.amount} מקומות._\n`;
    });

    body += "\n";
    body += "*סטטוס כל האיזורים הפנויים*:\n";
    body += allFreeSeatsHumanized;
  }

  await sendMessageViaBot(body, sendMessageOptions);
  console.log("Alert was sent!");
}

async function sendFailureStatusIfNeeded() {
  if (totalFailedRuns >= MAX_ERRORS_BEFORE_RESTART) {
    await getLastErrorsRequest();
    await getStatusRequest();
    await restartServerRequest();
  }
}

function shouldSendAlert(allFreeSeats, options = {}) {
  if (options.forceSendAlert) {
    console.log("forceSendAlert is on, forcing alert sending");
    return true;
  }

  const isAnyTrackedFreeSeatFound = getIsAnyTrackedFreeSeatFound(allFreeSeats);
  if (!isAnyTrackedFreeSeatFound) {
    console.log("All tracked areas have 0 free seats, skipping alert sending");
    return false;
  }

  const now = new Date();
  if (lastTimeAlertSent && now - lastTimeAlertSent <= THROTTLE_ALERT_TIME_MS) {
    if (currentAlertCount >= THROTTLE_MAX_ALERTS) {
      console.log(
        `${THROTTLE_MAX_ALERTS} alerts were sent in the last ${THROTTLE_ALERT_TIME_MINUTES} minutes, skipping this one`
      );
      return false;
    }
  } else {
    currentAlertCount = 0;
  }

  lastTimeAlertSent = now;
  currentAlertCount += 1;
  return true;
}

function getIsAnyTrackedFreeSeatFound(allFreeSeats) {
  // allFreeSeats contain only areas with free seats
  return allFreeSeats
    .map((freeAreaDetails) => freeAreaDetails.area)
    .some(getIsTrackedArea);
}

/**
 * we check whether an area is a tracked area in TRACKED_AREAS, in a safe way: ignoring whitespace and order of words
 */
function getIsTrackedArea(area) {
  return TRACKED_AREAS.some((trackedArea) => getIsSameArea(trackedArea, area));
}

/**
 * @param {*} area1 - e.g 'פרקט B'
 * @param {*} area2 - e.g 'באזור פרקט אמצע B .'
 * @returns - whether they are the same area (true in the example above)
 */
function getIsSameArea(area1, area2) {
  let areaShort, areaLong;
  if (area1.length < area2.length) {
    areaShort = area1;
    areaLong = area2;
  } else {
    areaShort = area2;
    areaLong = area1;
  }

  if (areaShort === areaLong) {
    return true;
  }

  const areaShortWords = areaShort.split(/\s+/);
  const areaLongWords = areaLong.split(/\s+/);

  if (areaShortWords.every((word) => areaLongWords.includes(word))) {
    console.warn(
      "Needed to use same area wording strategy, check the tracked area naming",
      { area1, area2 }
    );
    return true;
  }

  return false;
}

async function run(browser, options = {}) {
  let context = null;
  let page = null;

  try {
    const initPageResult = await initPage(browser);
    context = initPageResult.context;
    page = initPageResult.page;

    const allFreeSeats = await getAllFreeSeats(page);

    console.log("allFreeSeats:", allFreeSeats);

    await sendAlertIfNeeded(allFreeSeats, options);
    ++totalSuccessfulRuns;

    await page.close();
    await context.close();
  } catch (error) {
    console.error("Error while running an automation session", error);
    ++totalFailedRuns;
    failedRunsErrors.push(error);

    await page?.close();
    await context?.close();

    context = null;
    page = null;
    await sendFailureStatusIfNeeded();
  }
}

function getFormattedDate(date) {
  return moment(date).format("DD/MM/YYYY-HH:mm:ss");
}

async function restartServerRequest() {
  await sendMessageViaBot("מכבה ומדליק את השרת..");
  process.exit(1);
}

async function getLastErrorsRequest() {
  const sendMessageOptions = { withMentions: false };
  let message = "";

  if (totalFailedRuns >= MAX_ERRORS_BEFORE_RESTART) {
    message = "*Errors count is too high*\n";
    sendMessageOptions.withMentions = true;
  }

  message += `totalFailedRuns: ${totalFailedRuns}\n`;
  message += `_totalSuccessfulRuns:${totalSuccessfulRuns}_\n`;
  message += `\n*Last ${LAST_ERRORS_COUNT} errors in the server:*\n`;

  const lastErrors = failedRunsErrors.slice(LAST_ERRORS_COUNT * -1);
  message += lastErrors.map((e) => e.message).join("\n") || "(no errors)";

  await sendMessageViaBot(message, sendMessageOptions);
}

async function getStatusRequest() {
  void sendMessageViaBot(
    [
      `*התאריך עכשיו בשרת*: ${getFormattedDate(new Date())}`,
      `*התאריך שבו השרת עלה*: ${getFormattedDate(startupTime)}`,
      `*סה"כ זמן פעולה בדקות*: ${parseInt(
        (new Date() - startupTime) / 1000 / 60
      )}`,
      `*זכרון בשימוש*: ${parseInt(
        process.memoryUsage().rss / 1024 / 1024
      )} מגה`,
      ``,
      `*מספר השניות בין כל בדיקה*: ${INTERVAL_TIME_MS / 1000.0}`,
      `*מספר הדקות בין אלרטים*: ${THROTTLE_ALERT_TIME_MINUTES}`,
      ``,
      `*סה"כ ריצות שהצליחו עד כה*: ${totalSuccessfulRuns}`,
      `*סה"כ ריצות שנכשלו עד כה*: ${totalFailedRuns}`,
    ].join("\n")
  );
}

async function startAutomationSession() {
  const browser = await initBrowser();

  setInterval(() => run(browser), INTERVAL_TIME_MS);
  run(browser);

  await setBotCommand("ping_with_mentions", "ping with mentions", async () => {
    await new Promise((res) => setTimeout(res, 2000));
    void sendMessageViaBot("pong", {
      withMentions: true,
    });
  });

  await setBotCommand("restart", "restarts the server", () => {
    void restartServerRequest();
  });

  await setBotCommand(
    "get_last_errors",
    `last ${LAST_ERRORS_COUNT} erros`,
    () => {
      void getLastErrorsRequest();
    }
  );

  await setBotCommand("run_now", "run automation now", () => {
    void sendMessageViaBot("מריץ אוטומציה, פעולה זו יכולה לקחת עד חצי דקה..");
    void run(browser, { forceSendAlert: true, withFullStatus: true });
  });

  await setBotCommand("status", "status of the server", () => {
    void getStatusRequest();
  });
}

module.exports = { startAutomationSession };
