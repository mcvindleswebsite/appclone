/**
 * Blackjack rules, kept free of rendering and input so the game loop stays
 * simple. Six-deck shoe, dealer stands on soft 17 and peeks for blackjack,
 * blackjack pays 3:2, double on any first two cards (also after a split),
 * split up to four hands; split aces take one card each.
 */
import { RANKS, SUITS, type Card, type Rank } from "../solitaire/types";

const DECKS = 6;
/** Reshuffle once the shoe runs below this many cards (the cut card). */
const RESHUFFLE_AT = 52;
export const MAX_HANDS = 4;

export type HandResult = "blackjack" | "win" | "push" | "lose" | "bust";

export type Hand = {
  cards: Card[];
  bet: number;
  doubled: boolean;
  /** Split aces receive exactly one more card and can't act further. */
  fromSplitAces: boolean;
  done: boolean;
  result?: HandResult;
};

export const rankValue = (rank: Rank) => {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
};

/** Best total, counting aces as 1 where 11 would bust. */
export const handValue = (cards: Card[]) => {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += rankValue(card.rank);
    if (card.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
};

export const isBlackjack = (cards: Card[]) =>
  cards.length === 2 && handValue(cards).total === 21;

export const isBust = (cards: Card[]) => handValue(cards).total > 21;

/** Same value pairs split (so K + 10 can), as in most casinos. */
export const canSplitCards = (cards: Card[]) =>
  cards.length === 2 && rankValue(cards[0].rank) === rankValue(cards[1].rank);

/** Fisher–Yates shuffled six-deck shoe, every card face up by default. */
export const createShoe = (): Card[] => {
  const shoe: Card[] = [];
  for (let d = 0; d < DECKS; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) shoe.push({ suit, rank, faceUp: true });
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
};

export const needsReshuffle = (shoe: Card[]) => shoe.length < RESHUFFLE_AT;

export const dealerShouldHit = (cards: Card[]) => handValue(cards).total < 17;

/** Settles one player hand against the finished dealer hand. */
export const settleHand = (hand: Hand, dealer: Card[], isSplit: boolean): HandResult => {
  if (isBust(hand.cards)) return "bust";
  const player = handValue(hand.cards).total;
  const dealerTotal = handValue(dealer).total;
  // A two-card 21 after a split is an ordinary 21, not a blackjack.
  const playerBlackjack = !isSplit && isBlackjack(hand.cards);
  const dealerBlackjack = isBlackjack(dealer);
  if (playerBlackjack && dealerBlackjack) return "push";
  if (playerBlackjack) return "blackjack";
  if (dealerBlackjack) return "lose";
  if (dealerTotal > 21 || player > dealerTotal) return "win";
  if (player === dealerTotal) return "push";
  return "lose";
};

/** Total returned to the bankroll (stake included) for a settled hand. */
export const payout = (hand: Hand) => {
  switch (hand.result) {
    case "blackjack":
      return hand.bet + Math.floor(hand.bet * 1.5);
    case "win":
      return hand.bet * 2;
    case "push":
      return hand.bet;
    default:
      return 0;
  }
};
