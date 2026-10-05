const ada = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (n: number) => ada.format(Math.abs(n) < 0.005 ? 0 : n);
export const cardanoscanTx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;
export const shortHash = (hash: string) => (hash.length > 20 ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : hash);
