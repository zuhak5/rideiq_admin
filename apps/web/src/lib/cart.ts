export type CartItem = { product_id: string; qty: number };

type CartState = Record<string, CartItem[]>; // merchantId -> items

const STORAGE_KEY = 'rideiq_cart_v1';

function readState(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CartState;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeState(next: CartState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getCart(merchantId: string): CartItem[] {
  const s = readState();
  return Array.isArray(s[merchantId]) ? s[merchantId] : [];
}

export function setCart(merchantId: string, items: CartItem[]) {
  const s = readState();
  s[merchantId] = items.filter((i) => i && i.product_id && i.qty > 0);
  writeState(s);
}

export function addToCart(merchantId: string, productId: string, qty = 1) {
  const items = getCart(merchantId);
  const idx = items.findIndex((i) => i.product_id === productId);
  const nextQty = Math.min(Math.max(qty, 1), 99);
  if (idx >= 0) {
    items[idx] = { product_id: productId, qty: Math.min(items[idx].qty + nextQty, 99) };
  } else {
    items.push({ product_id: productId, qty: nextQty });
  }
  setCart(merchantId, items);
}

export function updateQty(merchantId: string, productId: string, qty: number) {
  const items = getCart(merchantId);
  const nextQty = Math.min(Math.max(qty, 0), 99);
  const next = items
    .map((i) => (i.product_id === productId ? { ...i, qty: nextQty } : i))
    .filter((i) => i.qty > 0);
  setCart(merchantId, next);
}

export function removeFromCart(merchantId: string, productId: string) {
  const items = getCart(merchantId).filter((i) => i.product_id !== productId);
  setCart(merchantId, items);
}

export function clearCart(merchantId: string) {
  setCart(merchantId, []);
}

export function cartCount(merchantId: string) {
  return getCart(merchantId).reduce((acc, i) => acc + (i.qty || 0), 0);
}

export function listMerchantsInCart() {
  const s = readState();
  return Object.keys(s).filter((k) => (s[k] ?? []).length > 0);
}
