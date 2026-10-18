/**
 * Blackjack game loop: owns the shoe, hands, bankroll, and pacing, listens to
 * the wheel, and reports which wheel actions are available so the click
 * wheel can relabel itself (Stand / Hit / Double / Split).
 */
import type { Card } from "../solitaire/types";
import type { WheelOverride } from "../../wheel-override";
import {
  MAX_HANDS,
  canSplitCards,
  createShoe,
  dealerShouldHit,
  handValue,
  isBlackjack,
  isBust,
  needsReshuffle,
  payout,
  rankValue,
  settleHand,
  type Hand,
} from "./engine";
import { Renderer, formatMoney } from "./Renderer";

export type WheelControls = Omit<WheelOverride, "viewId">;

type Phase = "betting" | "dealing" | "player" | "dealer" | "settled";

const START_BANK = 1000;
const MIN_BET = 10;
const MAX_BET = 500;
const BET_STEP = 10;
const DEAL_GAP_MS = 260;
const DEALER_GAP_MS = 550;
const BANK_KEY = "ipodBlackjackBank";
const BET_KEY = "ipodBlackjackBet";

const readNumber = (key: string, fallback: number) => {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
};

const writeNumber = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable; the bankroll just won't persist.
  }
};

const newHand = (cards: Card[], bet: number, fromSplitAces = false): Hand => ({
  cards,
  bet,
  doubled: false,
  fromSplitAces,
  done: false,
});

export default class BlackjackGame {
  private ctx: CanvasRenderingContext2D;
  private renderer: Renderer;
  private onControls: (controls: WheelControls) => void;
  private lastControlsKey = "";

  private shoe: Card[] = createShoe();
  private dealer: Card[] = [];
  private hands: Hand[] = [];
  private activeHand = 0;
  private phase: Phase = "betting";
  private bank = readNumber(BANK_KEY, START_BANK);
  private bet = readNumber(BET_KEY, 50);
  private message = "Blackjack";
  private hint = "";
  private dealtAt = new WeakMap<Card, number>();

  private timers: ReturnType<typeof setTimeout>[] = [];
  private frameId: number | null = null;
  private listeners: Array<{ event: string; handler: EventListener }> = [];

  constructor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    onControls: (controls: WheelControls) => void
  ) {
    this.ctx = ctx;
    this.renderer = new Renderer(ctx, width, height);
    this.onControls = onControls;
    this.bet = this.clampBet(this.bet);
    this.hint = `Spin to bet ${formatMoney(this.bet)} · Center to deal`;
  }

  init() {
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.listen("centerclick", () => this.handleCenter());
    this.listen("wheelright", () => this.hit());
    this.listen("wheelleft", () => this.double());
    this.listen("wheelbottom", () => this.split());
    this.listen("forwardscroll", () => this.adjustBet(BET_STEP));
    this.listen("backwardscroll", () => this.adjustBet(-BET_STEP));
    this.update();
  }

  cleanup() {
    this.listeners.forEach(({ event, handler }) => window.removeEventListener(event, handler));
    this.listeners = [];
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  resize(width: number, height: number) {
    this.renderer.resize(width, height);
    this.requestRender();
  }

  private listen(event: string, handler: () => void) {
    const wrapped = handler as EventListener;
    window.addEventListener(event, wrapped);
    this.listeners.push({ event, handler: wrapped });
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  /* ---------- Rendering & controls ---------- */

  private update() {
    this.emitControls();
    this.requestRender();
  }

  private requestRender() {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame((now) => {
      this.frameId = null;
      const animating = this.renderer.render(
        {
          dealer: this.dealer,
          hands: this.hands,
          activeHand: this.activeHand,
          isPlayerTurn: this.phase === "player",
          bank: this.bank,
          bet: this.bet,
          message: this.message,
          hint: this.hint,
          dealtAt: this.dealtAt,
        },
        now
      );
      if (animating) this.requestRender();
    });
  }

  private get currentHand(): Hand | undefined {
    return this.hands[this.activeHand];
  }

  private canDouble() {
    const hand = this.currentHand;
    return (
      this.phase === "player" &&
      !!hand &&
      hand.cards.length === 2 &&
      !hand.fromSplitAces &&
      this.bank >= hand.bet
    );
  }

  private canSplit() {
    const hand = this.currentHand;
    return (
      this.phase === "player" &&
      !!hand &&
      canSplitCards(hand.cards) &&
      !hand.fromSplitAces &&
      this.hands.length < MAX_HANDS &&
      this.bank >= hand.bet
    );
  }

  private emitControls() {
    const isPlayer = this.phase === "player";
    const isIdle = this.phase === "betting" || this.phase === "settled";
    const controls: WheelControls = {
      center: isIdle ? { label: "DEAL", enabled: true } : { label: "STAND", enabled: isPlayer },
      right: { label: "HIT", enabled: isPlayer },
      left: { label: "DOUBLE", enabled: this.canDouble() },
      bottom: { label: "SPLIT", enabled: this.canSplit() },
    };
    const key = JSON.stringify(controls);
    if (key === this.lastControlsKey) return;
    this.lastControlsKey = key;
    this.onControls(controls);
  }

  /* ---------- Betting ---------- */

  private clampBet(bet: number) {
    const ceiling = Math.max(MIN_BET, Math.min(MAX_BET, this.bank));
    return Math.min(Math.max(bet, MIN_BET), ceiling);
  }

  private adjustBet(delta: number) {
    if (this.phase !== "betting" && this.phase !== "settled") return;
    const next = this.clampBet(this.bet + delta);
    if (next === this.bet) return;
    this.bet = next;
    writeNumber(BET_KEY, next);
    this.hint = `Spin to bet ${formatMoney(this.bet)} · Center to deal`;
    this.update();
  }

  private handleCenter() {
    if (this.phase === "betting" || this.phase === "settled") this.deal();
    else if (this.phase === "player") this.stand();
  }

  /* ---------- Dealing ---------- */

  private draw(faceUp = true): Card {
    if (!this.shoe.length) this.shoe = createShoe();
    const card = { ...this.shoe.pop()!, faceUp };
    this.dealtAt.set(card, performance.now());
    return card;
  }

  private deal() {
    if (this.bank < MIN_BET) {
      this.bank = START_BANK;
      writeNumber(BANK_KEY, this.bank);
    }
    this.bet = this.clampBet(this.bet);
    const reshuffled = needsReshuffle(this.shoe);
    if (reshuffled) this.shoe = createShoe();

    this.bank -= this.bet;
    this.dealer = [];
    this.hands = [newHand([], this.bet)];
    this.activeHand = 0;
    this.phase = "dealing";
    this.message = reshuffled ? "Shuffling…" : "";
    this.hint = `BET ${formatMoney(this.bet)}`;
    this.update();

    const hand = this.hands[0];
    const steps = [
      () => hand.cards.push(this.draw()),
      () => this.dealer.push(this.draw()),
      () => hand.cards.push(this.draw()),
      () => this.dealer.push(this.draw(false)),
    ];
    steps.forEach((step, index) =>
      this.later(DEAL_GAP_MS * (index + 1), () => {
        step();
        this.update();
      })
    );
    this.later(DEAL_GAP_MS * (steps.length + 1), () => this.afterDeal());
  }

  /** Dealer peeks under an Ace or ten; naturals end the round at once. */
  private afterDeal() {
    const player = this.hands[0];
    const upCard = this.dealer[0];
    const dealerPeeks = upCard.rank === "A" || rankValue(upCard.rank) === 10;
    const dealerNatural = dealerPeeks && isBlackjack(this.dealer);

    if (dealerNatural || isBlackjack(player.cards)) {
      this.revealHole();
      this.settle();
      return;
    }
    this.message = "";
    this.phase = "player";
    this.update();
  }

  /* ---------- Player actions ---------- */

  private hit() {
    const hand = this.currentHand;
    if (this.phase !== "player" || !hand) return;
    hand.cards.push(this.draw());
    if (handValue(hand.cards).total >= 21) this.finishHand();
    else this.update();
  }

  private stand() {
    if (this.phase !== "player") return;
    this.finishHand();
  }

  private double() {
    const hand = this.currentHand;
    if (!this.canDouble() || !hand) return;
    this.bank -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(this.draw());
    this.finishHand();
  }

  private split() {
    const hand = this.currentHand;
    if (!this.canSplit() || !hand) return;
    const isAces = hand.cards[0].rank === "A";
    this.bank -= hand.bet;
    const moved = hand.cards.pop()!;
    hand.fromSplitAces = isAces;
    this.hands.splice(this.activeHand + 1, 0, newHand([moved], hand.bet, isAces));
    hand.cards.push(this.draw());
    if (isAces || handValue(hand.cards).total === 21) this.finishHand();
    else this.update();
  }

  /** Closes the active hand and moves on (dealing a split hand its 2nd card). */
  private finishHand() {
    const hand = this.currentHand;
    if (hand) hand.done = true;
    const next = this.hands.findIndex((h) => !h.done);
    if (next === -1) {
      this.phase = "dealer";
      this.update();
      this.later(DEAL_GAP_MS, () => this.dealerTurn());
      return;
    }

    this.activeHand = next;
    const nextHand = this.hands[next];
    this.phase = "dealing";
    this.update();
    this.later(DEAL_GAP_MS, () => {
      if (nextHand.cards.length < 2) nextHand.cards.push(this.draw());
      this.phase = "player";
      if (nextHand.fromSplitAces || handValue(nextHand.cards).total === 21) this.finishHand();
      else this.update();
    });
  }

  /* ---------- Dealer & settlement ---------- */

  private revealHole() {
    this.dealer = this.dealer.map((card) => (card.faceUp ? card : { ...card, faceUp: true }));
  }

  private dealerTurn() {
    this.revealHole();
    this.update();
    // Nothing to beat when every hand already busted.
    if (this.hands.every((hand) => isBust(hand.cards))) {
      this.later(DEALER_GAP_MS, () => this.settle());
      return;
    }
    const step = () => {
      if (dealerShouldHit(this.dealer)) {
        this.dealer.push(this.draw());
        this.update();
        this.later(DEALER_GAP_MS, step);
      } else {
        this.settle();
      }
    };
    this.later(DEALER_GAP_MS, step);
  }

  private settle() {
    const isSplit = this.hands.length > 1;
    let staked = 0;
    let returned = 0;
    for (const hand of this.hands) {
      hand.result = settleHand(hand, this.dealer, isSplit);
      staked += hand.bet;
      returned += payout(hand);
    }
    this.bank += returned;
    writeNumber(BANK_KEY, this.bank);

    const net = returned - staked;
    const only = this.hands[0].result;
    if (!isSplit && only === "blackjack") this.message = `Blackjack! +${formatMoney(net)}`;
    else if (!isSplit && only === "bust") this.message = `Bust −${formatMoney(-net)}`;
    else if (net > 0) this.message = `You win +${formatMoney(net)}`;
    else if (net < 0) this.message = `Dealer wins −${formatMoney(-net)}`;
    else this.message = "Push";

    this.phase = "settled";
    this.bet = this.clampBet(this.bet);
    this.hint =
      this.bank < MIN_BET
        ? "Out of chips · Center for a fresh $1,000"
        : `Spin to bet ${formatMoney(this.bet)} · Center to deal`;
    this.update();
  }
}
