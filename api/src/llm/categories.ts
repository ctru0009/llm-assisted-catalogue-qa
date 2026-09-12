export const ALLOWED_CATEGORIES = [
  "Apparel & Accessories > Shoes > Athletic Shoes",
  "Apparel & Accessories > Shoes > Sneakers",
  "Apparel & Accessories > Clothing > Clothing Tops > Shirts > Dress Shirts",
  "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts",
  "Luggage & Bags > Backpacks > Hiking Backpacks",
  "Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Cross Body Bags",
  "Apparel & Accessories > Clothing > Clothing Tops > Polos",
  "Luggage & Bags > Tote Bags",
] as const;

export type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];
