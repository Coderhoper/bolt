import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function AdminProducts() {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    const { data, error } = await supabase.from('products').select('*').order('id', { ascending: false }).limit(100);
    if (error) console.error(error);
    else setProducts(data || []);
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('products').insert({ name, sku, price: price ? Number(price) : null });
    if (error) return console.error(error);
    setName(''); setSku(''); setPrice('');
    fetchProducts();
  }

  async function addStock(productId: number) {
    const amount = Number(prompt('Quantity to add (positive for addition, negative to remove):', '1')) || 0;
    if (!amount) return;
    const { error } = await supabase.from('stock_movements').insert({ product_id: productId, change: amount });
    if (error) console.error(error);
    else fetchProducts();
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Admin — Products</h2>

      <form onSubmit={createProduct} className="mb-6">
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="border p-2 mr-2" />
        <input placeholder="SKU" value={sku} onChange={e => setSku(e.target.value)} className="border p-2 mr-2" />
        <input placeholder="Price" value={price} onChange={e => setPrice(e.target.value)} className="border p-2 mr-2" />
        <button className="bg-blue-600 text-white px-3 py-2">Create</button>
      </form>

      <table className="w-full table-auto">
        <thead>
          <tr>
            <th className="text-left">ID</th>
            <th className="text-left">Name</th>
            <th className="text-left">SKU</th>
            <th className="text-left">Price</th>
            <th className="text-left">Quantity</th>
            <th className="text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.name}</td>
              <td>{p.sku}</td>
              <td>{p.price}</td>
              <td>{p.quantity}</td>
              <td>
                <button className="mr-2 text-sm text-blue-600" onClick={() => addStock(p.id)}>Add stock</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
