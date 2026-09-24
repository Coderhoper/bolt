import { supabase } from './supabase';

export type Product = {
  id?: number;
  name: string;
  sku?: string | null;
  price?: number | null;
  quantity?: number | null;
  created_at?: string;
};

export async function createProduct(payload: { name: string; sku?: string; price?: number | null }) {
  const { data, error } = await supabase.from<Product>('products').insert(payload).select().single();
  return { data, error };
}

export async function addStock(productId: number, change: number, note?: string) {
  const { data, error } = await supabase.from('stock_movements').insert({ product_id: productId, change, note }).select().single();
  return { data, error };
}

export async function listProducts(limit = 100) {
  const { data, error } = await supabase.from<Product>('products').select('*').order('name', { ascending: true }).limit(limit);
  return { data, error };
}

// Example usage:
// const { data: prod } = await createProduct({ name: 'Hammer', sku: 'HAM-001', price: 12.5 });
// await addStock(prod.id, 10, 'Initial stock');
// const { data: items } = await listProducts();
