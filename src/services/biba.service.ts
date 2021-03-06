import Bull from 'bull';
import { ContextMessageUpdate, Markup } from 'telegraf';

import { Message } from 'telegraf/typings/telegram-types';
import { BibaCommand } from '../types/globals/commands.types';
import { getProductPrice, getActionByProduct } from '../utils/shop.helper';
import {
  Biba,
  POSITIVE_BIBA,
  NEGATIVE_BIBA,
  NO_TABLE_DATA,
  NO_BIBA_MEASURED,
} from '../types/services/biba.service.types';
import Bot from '../core/bot';
import { BotCommandType } from '../types/core/bot.types';
import BibaRepository from '../repositories/biba.repo';
import ChatRepository from '../repositories/chat.repo';
import { Product } from '../types/services/shop.service.types';
import BaseService from './base.service';
import DeleteRequestMessage from '../decorators/delete.request.message.decorator';
import DeleteLastMessage from '../decorators/delete.last.message.decorator';
import DeleteResponseMessage from '../decorators/delete.response.message.decorator';
import getUsernameFromContext from '../utils/global.helper';

export default class BibaService extends BaseService {
  private static instance: BibaService;

  private constructor(
    private readonly bibaRepo: BibaRepository,
    private readonly chatRepo: ChatRepository,
  ) {
    super();
  }

  public static getInstance(): BibaService {
    if (!BibaService.instance) {
      BibaService.instance = new BibaService(
        new BibaRepository(),
        new ChatRepository(),
      );
    }

    return BibaService.instance;
  }

  @DeleteRequestMessage()
  private static async unrankedBibaMetr(ctx: ContextMessageUpdate): Promise<Message> {
    const username = getUsernameFromContext(ctx);
    return ctx.reply(`У ${username} биба ${Math.floor(Math.random() * (35 + 1))} см`);
  }

  private static getDailyMessage(allBibas: Array<Biba>): string {
    if (!allBibas.length) return NO_BIBA_MEASURED;

    const topBiba = allBibas.shift();
    const lowBiba = allBibas.pop();

    return `👑 Королевская биба сегодня у ${topBiba!.username} - ${topBiba!.size} см\n\n`
         + `👌 Обсосом дня становится ${lowBiba!.username} - ${lowBiba!.size} см`;
  }

  @DeleteResponseMessage(10000)
  private static async sendRerollBlockedMessage(ctx: ContextMessageUpdate, username: string): Promise<Message> {
    const price = getProductPrice(Product.BIBA_REROLL);
    await ctx.deleteMessage();
    return ctx.reply(
      `${username} сегодня уже мерял бибу, приходи завтра или купи ещё одну попытку за ${price} бибакоинов`,
      Markup.inlineKeyboard(
        [Markup.callbackButton(
          `Перемерять бибу 💰${price}¢`,
          getActionByProduct(Product.BIBA_REROLL),
        )],
      ).extra(),
    );
  }

  public async bibaMetr(ctx: ContextMessageUpdate, forceReroll?: boolean): Promise<Message> {
    const user = (ctx.message && ctx.message!.from!) || ctx.from!;
    const username = getUsernameFromContext(ctx);
    const biba = Math.floor(Math.random() * (35 + 1));
    const lastBiba = await this.bibaRepo.getBibaByIds(ctx.chat!.id, user!.id);
    let bibaMessage = `У ${username} биба ${biba} см`;

    if (lastBiba) {
      if (!lastBiba.outdated && !forceReroll) {
        return BibaService.sendRerollBlockedMessage(ctx, username);
      }

      bibaMessage = `У ${username} биба ${biba} см, в прошлый раз была ${lastBiba.size} см. `
                  + `${biba - lastBiba.size > 0 ? POSITIVE_BIBA : NEGATIVE_BIBA}`;
    }

    await this.bibaRepo.setBiba(
      ctx.chat!.id,
      {
        size: biba,
        username,
        outdated: false,
        userId: user!.id,
      },
    );

    return ctx.reply(bibaMessage);
  }

  public async dailyBiba(done: Bull.DoneCallback): Promise<void> {
    try {
      const chatIds = await this.chatRepo.getAllChats();

      await Promise.all(chatIds.map(async (chatId) => {
        console.log(`[${chatId}] Daily biba`);

        const allBibas = await this.bibaRepo.getAllBibasByChatId(chatId);
        const message = BibaService.getDailyMessage(allBibas);

        if (!allBibas.length) {
          await this.bot.app.telegram.sendMessage(chatId, message);
          return;
        }

        await this.bot.app.telegram.sendMessage(chatId, message);

        await this.bibaRepo.setAllBibasOutdated(chatId);
      }));
    } catch (err) {
      Bot.handleError(err);
    }

    done();
  }

  protected initListeners(): void {
    this.bot.addListeners([
      {
        type: BotCommandType.COMMAND,
        name: BibaCommand.BIBA,
        callback: (ctx): Promise<Message> => this.bibaMetr(ctx),
      },
      {
        type: BotCommandType.COMMAND,
        name: BibaCommand.UNRANKED_BIBA,
        callback: (ctx): Promise<Message> => BibaService.unrankedBibaMetr(ctx),
      },
      {
        type: BotCommandType.COMMAND,
        name: BibaCommand.BIBA_TABLE,
        callback: (ctx): Promise<Message> => this.bibaTable(ctx),
      },
    ]);
  }

  @DeleteRequestMessage()
  @DeleteLastMessage('biba_table')
  private async bibaTable(ctx: ContextMessageUpdate): Promise<Message> {
    const allBibas = await this.bibaRepo.getAllBibasByChatId(ctx.chat!.id);

    if (!allBibas.length) {
      return ctx.reply(NO_TABLE_DATA);
    }

    const message = allBibas.map((biba, index) => `${index + 1}. ${biba.username.replace('@', '')} - ${biba.size} см`);
    return ctx.reply(message.join('\n'));
  }
}
