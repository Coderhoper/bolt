export type UserRole = 'admin' | 'owner';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subcategory {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_balance: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  category_id: string | null;
  subcategory_id?: string | null;
  supplier_id: string | null;
  brand: string | null;
  unit: string;
  buying_price: number;
  selling_price: number;
  profit_per_unit: number;
  current_stock: number;
  minimum_stock: number;
  maximum_stock: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  category?: Category;
  supplier?: Supplier;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  brand?: string | null;
  size?: string | null;
  specification?: string | null;
  unit?: string | null;
  sku?: string | null;
  cost_price: number;
  selling_price: number;
  current_stock: number;
  reorder_level: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  product?: Product;
}

export interface StockMovement {
  id: string;
  product_id: string;
  movement_type: 'purchase' | 'sale' | 'adjustment' | 'opening';
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  product?: Product;
}

export interface Purchase {
  id: string;
  supplier_id: string | null;
  invoice_number: string | null;
  purchase_date: string;
  total_amount: number;
  amount_paid: number;
  payment_status: 'paid' | 'partial' | 'credit';
  note: string | null;
  created_by: string | null;
  created_at: string;
  supplier?: Supplier;
  purchase_items?: PurchaseItem[];
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  quantity: number;
  buying_price: number;
  total: number;
  product?: Product;
}

export interface Sale {
  id: string;
  sale_number: string | null;
  customer_name: string | null;
  sale_date: string;
  payment_method: 'cash' | 'mpesa' | 'bank' | 'credit';
  total_amount: number;
  total_cost: number;
  total_profit: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  sale_items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_variant_id?: string | null;
  quantity: number;
  selling_price: number;
  buying_price: number;
  total: number;
  profit: number;
  product?: Product;
  product_variant?: ProductVariant;
}

export interface Expense {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  expense_date: string;
  payment_method: 'cash' | 'mpesa' | 'bank' | 'other';
  created_by: string | null;
  created_at: string;
}

export interface Employee {
  id: string;
  full_name: string;
  national_id: string | null;
  phone: string | null;
  address: string | null;
  position: string | null;
  date_employed: string | null;
  basic_salary: number;
  employment_status: 'active' | 'inactive' | 'terminated';
  emergency_contact: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalaryRecord {
  id: string;
  employee_id: string;
  pay_period_month: number;
  pay_period_year: number;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_salary: number;
  payment_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  employee?: Employee;
}

export interface ProfitTarget {
  id: string;
  target_month: number;
  target_year: number;
  expected_profit: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  description: string | null;
  created_at: string;
}

export interface SystemSettings {
  id: string;
  business_name: string;
  business_address: string | null;
  business_phone: string | null;
  business_email: string | null;
  currency: string;
  email_recipients: string[];
  weekly_report_day: number;
  weekly_report_enabled: boolean;
  monthly_report_enabled: boolean;
  updated_at: string;
}

export interface DashboardSummary {
  total_sales: number;
  total_purchases: number;
  total_expenses: number;
  total_cogs: number;
  gross_profit: number;
  net_profit: number;
  stock_value: number;
  low_stock_count: number;
  total_products: number;
  total_employees: number;
  expected_profit: number;
  deficit: number;
  start_date: string;
  end_date: string;
}
