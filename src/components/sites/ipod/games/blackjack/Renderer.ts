/**
 * Draws the Blackjack table. Cards, felt, and suit art deliberately match the
 * Solitaire renderer (same gradients, borders, Apple-logo backs, and suit
 * SVGs) so both games look like one set; that renderer is left untouched.
 */
import { SUIT_SYMBOLS, getColor, type Card, type Suit } from "../solitaire/types";
import { handValue, type Hand, type HandResult } from "./engine";

const CARD_RADIUS = 3;
const HIGHLIGHT_ORANGE = "#FF8C00";
const TEXT_COLOR = "#FFFFFF";
const MUTED_TEXT = "rgba(255, 255, 255, 0.7)";
const DEAL_ANIM_MS = 220;

const RESULT_STYLE: Record<HandResult, { label: string; color: string }> = {
  blackjack: { label: "BLACKJACK", color: "#FFD54A" },
  win: { label: "WIN", color: "#7CE38B" },
  push: { label: "PUSH", color: "#FFFFFF" },
  lose: { label: "LOSE", color: "#FF8A80" },
  bust: { label: "BUST", color: "#FF8A80" },
};

export type TableState = {
  dealer: Card[];
  hands: Hand[];
  activeHand: number;
  /** Highlight the active hand only while the player is deciding. */
  isPlayerTurn: boolean;
  bank: number;
  bet: number;
  message: string;
  hint: string;
  /** When each card was dealt, for the slide-in from the shoe. */
  dealtAt: WeakMap<Card, number>;
};

type Point = { x: number; y: number };

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export const formatMoney = (amount: number) => `$${amount.toLocaleString("en-US")}`;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private scale: number;
  private cardWidth: number;
  private cardHeight: number;
  private suitImages: Record<string, HTMLImageElement> = {};
  private appleLogo: HTMLImageElement | null = null;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.scale = height / 232;
    this.cardHeight = Math.floor(height * 0.27);
    this.cardWidth = Math.floor(this.cardHeight / 1.4);
    this.loadAssets();
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = height / 232;
    this.cardHeight = Math.floor(height * 0.27);
    this.cardWidth = Math.floor(this.cardHeight / 1.4);
  }

  /** Same recolored suit SVGs and Apple logo the Solitaire cards use. */
  private loadAssets() {
    const suitFiles: Record<Suit, { file: string; color: string }> = {
      hearts: { file: "heart.svg", color: "#CC0000" },
      diamonds: { file: "diamond.svg", color: "#CC0000" },
      clubs: { file: "club.svg", color: "#000000" },
      spades: { file: "spade.svg", color: "#000000" },
    };
    for (const [suit, { file, color }] of Object.entries(suitFiles)) {
      this.loadColoredSvg(`/sites/ipod/${file}`, color, (img) => {
        this.suitImages[suit] = img;
      });
    }
    this.loadColoredSvg("/sites/ipod/apple.svg", "#FFFFFF", (img) => {
      this.appleLogo = img;
    });
  }

  private loadColoredSvg(url: string, fillColor: string, onLoad: (img: HTMLImageElement) => void) {
    fetch(url)
      .then((res) => res.text())
      .then((svgText) => {
        const colored = svgText.replace(/fill="#000000"/g, `fill="${fillColor}"`);
        const blobUrl = URL.createObjectURL(new Blob([colored], { type: "image/svg+xml" }));
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          onLoad(img);
        };
        img.onerror = () => URL.revokeObjectURL(blobUrl);
        img.src = blobUrl;
      })
      .catch(() => undefined);
  }

  /** Draws the table; returns true while any card is still sliding in. */
  render(state: TableState, now: number): boolean {
    const s = this.scale;
    this.drawBackground();

    let animating = false;
    const dealerY = Math.floor(16 * s);
    const playerY = this.height - this.cardHeight - Math.floor(16 * s);

    // Dealer: total counts only face-up cards until the hole card turns.
    const dealerVisible = state.dealer.filter((card) => card.faceUp);
    if (state.dealer.length) {
      const total = handValue(dealerVisible).total;
      this.drawText(`DEALER  ${total}`, 6 * s, 4 * s, 9, "left", MUTED_TEXT, true);
    }
    animating =
      this.drawRow(state.dealer, this.width / 2, dealerY, this.width - 12 * s, state.dealtAt, now) ||
      animating;

    // Bank top-right; bet and messages in the middle band.
    this.drawText(`BANK ${formatMoney(state.bank)}`, this.width - 6 * s, 4 * s, 9, "right", MUTED_TEXT, true);
    const middleY = (dealerY + this.cardHeight + playerY) / 2;
    if (state.message) {
      this.drawText(state.message, this.width / 2, middleY - 7 * s, 12, "center", TEXT_COLOR, true);
    }
    const betLine = state.hint || `BET ${formatMoney(state.bet)}`;
    this.drawText(betLine, this.width / 2, middleY + 8 * s, 9, "center", MUTED_TEXT, false);

    // Player hands share the width; each gets its total (or result) beneath.
    const count = Math.max(state.hands.length, 1);
    const slotWidth = this.width / count;
    state.hands.forEach((hand, index) => {
      const centerX = slotWidth * index + slotWidth / 2;
      const isActive = state.isPlayerTurn && index === state.activeHand && count > 1;
      animating =
        this.drawRow(hand.cards, centerX, playerY, slotWidth - 10 * s, state.dealtAt, now, isActive) ||
        animating;

      const labelY = playerY + this.cardHeight + 3 * s;
      if (hand.result) {
        const { label, color } = RESULT_STYLE[hand.result];
        this.drawText(label, centerX, labelY, 9, "center", color, true);
      } else if (hand.cards.length) {
        const { total, soft } = handValue(hand.cards);
        const text = soft && total < 21 ? `${total - 10}/${total}` : `${total}`;
        const prefix = count > 1 ? "" : "YOU  ";
        this.drawText(`${prefix}${text}${hand.doubled ? "  ×2" : ""}`, centerX, labelY, 9, "center", isActive ? HIGHLIGHT_ORANGE : MUTED_TEXT, true);
      }
    });

    return animating;
  }

  /** Lays a hand out as a centered fan that shows each card's corner index. */
  private drawRow(
    cards: Card[],
    centerX: number,
    y: number,
    maxWidth: number,
    dealtAt: WeakMap<Card, number>,
    now: number,
    highlight = false
  ): boolean {
    if (!cards.length) return false;
    const { cardWidth, cardHeight } = this;
    const preferredStep = cardWidth * 0.62;
    const step =
      cards.length > 1
        ? Math.min(preferredStep, (maxWidth - cardWidth) / (cards.length - 1))
        : 0;
    const rowWidth = cardWidth + step * (cards.length - 1);
    const startX = centerX - rowWidth / 2;

    if (highlight) {
      const pad = 3 * this.scale;
      this.ctx.fillStyle = "rgba(255, 140, 0, 0.15)";
      this.roundRect(startX - pad, y - pad, rowWidth + pad * 2, cardHeight + pad * 2, CARD_RADIUS + 1);
      this.ctx.fill();
      this.ctx.strokeStyle = HIGHLIGHT_ORANGE;
      this.ctx.lineWidth = 2 * this.scale;
      this.roundRect(startX - pad, y - pad, rowWidth + pad * 2, cardHeight + pad * 2, CARD_RADIUS + 1);
      this.ctx.stroke();
    }

    let animating = false;
    cards.forEach((card, index) => {
      const target = { x: startX + step * index, y };
      const position = this.dealPosition(card, target, dealtAt, now);
      if (position !== target) animating = true;
      if (card.faceUp) this.drawCard(card, position.x, position.y);
      else this.drawCardBack(position.x, position.y);
    });
    return animating;
  }

  /** Slides a fresh card in from the shoe at the top-right corner. */
  private dealPosition(card: Card, target: Point, dealtAt: WeakMap<Card, number>, now: number): Point {
    const start = dealtAt.get(card);
    if (start === undefined) return target;
    const t = (now - start) / DEAL_ANIM_MS;
    if (t >= 1) return target;
    const eased = easeOut(Math.max(0, t));
    const from = { x: this.width + this.cardWidth * 0.2, y: -this.cardHeight * 0.6 };
    return {
      x: from.x + (target.x - from.x) * eased,
      y: from.y + (target.y - from.y) * eased,
    };
  }

  private drawBackground() {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, "#2D5E3F");
    gradient.addColorStop(0.5, "#1E4D30");
    gradient.addColorStop(1, "#163D25");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawText(
    text: string,
    x: number,
    y: number,
    size: number,
    align: CanvasTextAlign,
    color: string,
    bold: boolean
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${bold ? "bold " : ""}${Math.floor(size * this.scale)}px sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawCard(card: Card, x: number, y: number) {
    const { cardWidth, cardHeight, ctx } = this;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = 3 * this.scale;
    ctx.shadowOffsetY = 1 * this.scale;
    ctx.fillStyle = "#FFFFFF";
    this.roundRect(x, y, cardWidth, cardHeight, CARD_RADIUS);
    ctx.fill();
    ctx.restore();

    const gradient = ctx.createLinearGradient(x, y, x, y + cardHeight);
    gradient.addColorStop(0, "#FFFFFF");
    gradient.addColorStop(1, "#E8E8E8");
    ctx.fillStyle = gradient;
    this.roundRect(x, y, cardWidth, cardHeight, CARD_RADIUS);
    ctx.fill();

    ctx.strokeStyle = "#AAAAAA";
    ctx.lineWidth = 1;
    this.roundRect(x, y, cardWidth, cardHeight, CARD_RADIUS);
    ctx.stroke();

    ctx.fillStyle = getColor(card.suit) === "red" ? "#CC0000" : "#000000";
    const fontSize = Math.floor(10 * this.scale);
    const smallSuitSize = Math.floor(9 * this.scale);
    const largeSuitSize = Math.floor(14 * this.scale);

    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const rankX = x + 3 * this.scale;
    const rankY = y + 2 * this.scale;
    ctx.fillText(card.rank, rankX, rankY);
    const metrics = ctx.measureText(card.rank);
    const textCenterY =
      rankY + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    this.drawSuit(card.suit, rankX + metrics.width + 1 * this.scale + smallSuitSize / 2, textCenterY, smallSuitSize);
    this.drawSuit(card.suit, x + cardWidth / 2, y + cardHeight / 2 + 3 * this.scale, largeSuitSize);
  }

  private drawCardBack(x: number, y: number) {
    const { cardWidth, cardHeight, ctx } = this;
    const border = 2 * this.scale;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = 3 * this.scale;
    ctx.shadowOffsetY = 1 * this.scale;
    ctx.fillStyle = "#FFFFFF";
    this.roundRect(x, y, cardWidth, cardHeight, CARD_RADIUS);
    ctx.fill();
    ctx.restore();

    const ix = x + border;
    const iy = y + border;
    const iw = cardWidth - border * 2;
    const ih = cardHeight - border * 2;
    const innerRadius = Math.max(1, CARD_RADIUS - 1);
    const gradient = ctx.createLinearGradient(ix, iy, ix, iy + ih);
    gradient.addColorStop(0, "#4A90D9");
    gradient.addColorStop(1, "#1B5AAF");
    ctx.fillStyle = gradient;
    this.roundRect(ix, iy, iw, ih, innerRadius);
    ctx.fill();

    const stripeHeight = 1.5 * this.scale;
    const stripeGap = 2.5 * this.scale;
    const stripeInset = 1 * this.scale;
    ctx.save();
    this.roundRect(ix, iy, iw, ih, innerRadius);
    ctx.clip();
    ctx.fillStyle = "rgba(106, 171, 224, 0.3)";
    for (let sy = iy + stripeInset; sy < iy + ih - stripeInset; sy += stripeHeight + stripeGap) {
      const stripeH = Math.min(stripeHeight, iy + ih - stripeInset - sy);
      if (stripeH > 0) ctx.fillRect(ix + stripeInset, sy, iw - stripeInset * 2, stripeH);
    }
    ctx.restore();

    if (this.appleLogo) {
      const logoH = ih * 0.34;
      const logoW = logoH * (814 / 1000);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.appleLogo, x + (cardWidth - logoW) / 2, y + (cardHeight - logoH) / 2, logoW, logoH);
      ctx.globalAlpha = 1;
    }
  }

  private drawSuit(suit: Suit, x: number, y: number, size: number) {
    const img = this.suitImages[suit];
    if (img) {
      this.ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      return;
    }
    const ctx = this.ctx;
    ctx.fillStyle = getColor(suit) === "red" ? "#CC0000" : "#000000";
    ctx.font = `${size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(SUIT_SYMBOLS[suit], x, y);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
