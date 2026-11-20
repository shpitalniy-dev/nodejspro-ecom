// demo:gates "types-broken" — a real typo-class defect: tsc must say no.
interface Order {
  totalCents: number;
}

export const order: Order = { totalCent: 100 };
