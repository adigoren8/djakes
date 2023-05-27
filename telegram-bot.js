const TelegramBot = require("node-telegram-bot-api");

const TELEGRAM_BOT_TOKEN = "5318952976:AAEWthgOwSdhLve0DXx2AkFQxxXowHUTlmU";
const CHAT_ID = "-666341157";
const MENTION_USERS_NAMES = [
  "@idandavidi",
  "@draovyi",
  "@orfromm",
  "@noydavidi",
];

const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const botCommands = [];

async function sendMessageViaBot(message, options = {}) {
  console.log("Sending a message via telegram bot..");

  let disableNotification = options.disableNotification;

  if (options.withMentions) {
    message += `\n${MENTION_USERS_NAMES.join(" ")}`;
  }

  if (options.withAlertTag) {
    message += `\n\n#alert`;
  }

  if (options.withMentions) {
    disableNotification = disableNotification ?? false;
  } else {
    disableNotification = disableNotification ?? true;
  }

  const botResult = await telegramBot.sendMessage(CHAT_ID, message, {
    parse_mode: "Markdown",
    disable_notification: disableNotification ?? true,
  });
  console.log("botResult", botResult);
}

async function setBotCommand(command, description, callback) {
  botCommands.push({ command, description: description });
  await telegramBot.setMyCommands(botCommands);

  telegramBot.onText(new RegExp("/" + command), (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) {
      console.error("Chat id is not recognized", { chatId: msg.chat.id });
      return;
    }

    console.log(`received "${msg.text}" command`);
    callback(msg);
  });
}

module.exports = { sendMessageViaBot, setBotCommand };
