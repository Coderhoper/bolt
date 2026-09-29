import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle, ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronRight,
  ClipboardCheck, FileImage, FileText, Package, Plus, RefreshCw, Search,
  ShieldCheck, Truck, Upload, X,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { supabase, getActiveTenantId } from '@/lib/supabase';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import type { Product, Supplier } from '@/types';

type OrderStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'acknowledged' | 'partially_fulfilled' | 'fulfilled' | 'cancelled' | 'disputed';
type AsnStatus = 'announced' | 'in_transit' | 'arrived' | 'receiving' | 'partially_received' | 'received' | 'cancelled' | 'disputed';
type DocumentStatus = 'pending_review' | 'posted' | 'rejected';
type Tab = 'overview' | 'orders' | 'shipments' | 'documents';

interface OrderLine {
  id: string;
  line_no: number;
  product_id: string;
  description: string | null;
  unit: string | null;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number;
  line_total: number;
  product?: Pick<Product, 'name' | 'unit'>;
}

interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  status: OrderStatus;
  expected_delivery: string | null;
  total_amount: number;
  notes: string | null;
  created_at: string;
  supplier?: Pick<Supplier, 'name'>;
  lines: OrderLine[];
}

interface AsnLine {
  id: string;
  line_no: number;
  product_id: string;
  description: string;
  unit: string | null;
  quantity_expected: number;
  quantity_received: number;
  unit_price: number;
  purchase_order_line_id: string | null;
  product?: Pick<Product, 'name' | 'unit'>;
}

interface Shipment {
  id: string;
  asn_number: string;
  supplier_id: string;
  purchase_order_id: string | null;
  status: AsnStatus;
  expected_arrival_date: string | null;
  actual_arrival_at: string | null;
  vehicle_reg: string | null;
  notes: string | null;
  created_at: string;
  supplier?: Pick<Supplier, 'name'>;
  purchase_order?: Pick<PurchaseOrder, 'order_number'>;
  lines: AsnLine[];
}

interface ReceiptLine {
  id: string;
  line_no: number;
  product_id: string;
  description: string | null;
  quantity_received: number;
  unit_price: number;
  asn_line_id: string | null;
  purchase_order_line_id: string | null;
  product?: Pick<Product, 'name' | 'unit'>;
}

interface ReceivingDocument {
  id: string;
  supplier_id: string;
  asn_id: string | null;
  document_type: string;
  status: DocumentStatus;
  invoice_number: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  notes: string | null;
  purchase_id: string | null;
  created_at: string;
  posted_at: string | null;
  supplier?: Pick<Supplier, 'name'>;
  asn?: Pick<Shipment, 'asn_number'>;
  lines: ReceiptLine[];
}

interface DraftLine {
  product_id: string;
  quantity: string;
  unit_price: string;
}

interface ReviewDraftLine extends DraftLine {
  asn_line_id: string;
  purchase_order_line_id: string;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500';

function orderStatusLabel(status: OrderStatus) {
  return ({ draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'Approved', sent: 'Sent to supplier', acknowledged: 'Acknowledged', partially_fulfilled: 'Partially received', fulfilled: 'Complete', cancelled: 'Cancelled', disputed: 'Disputed' })[status];
}

function shipmentStatusLabel(status: AsnStatus) {
  return ({ announced: 'Announced', in_transit: 'In transit', arrived: 'Arrived', receiving: 'Receiving', partially_received: 'Partially received', received: 'Received', cancelled: 'Cancelled', disputed: 'Disputed' })[status];
}

function StatusBadge({ children, tone = 'slate' }: { children: string; tone?: 'slate' | 'blue' | 'amber' | 'green' | 'rose' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
    rose: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function orderTone(status: OrderStatus): 'slate' | 'blue' | 'amber' | 'green' | 'rose' {
  if (status === 'fulfilled') return 'green';
  if (status === 'disputed' || status === 'cancelled') return 'rose';
  if (status === 'draft') return 'slate';
  if (status === 'partially_fulfilled' || status === 'pending_approval') return 'amber';
  return 'blue';
}

function shipmentTone(status: AsnStatus): 'slate' | 'blue' | 'amber' | 'green' | 'rose' {
  if (status === 'received') return 'green';
  if (status === 'disputed' || status === 'cancelled') return 'rose';
  if (status === 'announced') return 'slate';
  if (status === 'arrived' || status === 'partially_received' || status === 'receiving') return 'amber';
  return 'blue';
}

function makeNumber(prefix: 'PO' | 'ASN') {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${day}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function hasValidFileSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (file.type === 'application/pdf') return text(0, 5) === '%PDF-';
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  if (file.type === 'image/webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  return false;
}

export function Receiving() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [documents, setDocuments] = useState<ReceivingDocument[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderSupplierId, setOrderSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [orderDraftLines, setOrderDraftLines] = useState<DraftLine[]>([{ product_id: '', quantity: '1', unit_price: '' }]);
  const [savingOrder, setSavingOrder] = useState(false);

  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [shipmentOrderId, setShipmentOrderId] = useState('');
  const [shipmentNumber, setShipmentNumber] = useState(makeNumber('ASN'));
  const [shipmentDate, setShipmentDate] = useState('');
  const [vehicleReg, setVehicleReg] = useState('');
  const [driverName, setDriverName] = useState('');
  const [shipmentNotes, setShipmentNotes] = useState('');
  const [shipmentDraftLines, setShipmentDraftLines] = useState<{ purchase_order_line_id: string; quantity: string }[]>([]);
  const [savingShipment, setSavingShipment] = useState(false);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadSupplierId, setUploadSupplierId] = useState('');
  const [uploadAsnId, setUploadAsnId] = useState('');
  const [documentType, setDocumentType] = useState('delivery_note');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [reviewDocument, setReviewDocument] = useState<ReceivingDocument | null>(null);
  const [reviewLines, setReviewLines] = useState<ReviewDraftLine[]>([]);
  const [documentUrl, setDocumentUrl] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    const [ordersResult, shipmentsResult, documentsResult, productsResult, suppliersResult] = await Promise.all([
      supabase.from('supplier_purchase_orders')
        .select('*, supplier:suppliers(name), lines:supplier_purchase_order_lines(*, product:products(name, unit))')
        .order('created_at', { ascending: false }),
      supabase.from('supplier_asns')
        .select('*, supplier:suppliers(name), purchase_order:supplier_purchase_orders(order_number), lines:supplier_asn_lines(*, product:products(name, unit))')
        .order('created_at', { ascending: false }),
      supabase.from('receiving_documents')
        .select('*, supplier:suppliers(name), asn:supplier_asns(asn_number), lines:receiving_document_lines(*, product:products(name, unit))')
        .order('created_at', { ascending: false }),
      supabase.from('products').select('*').eq('status', 'active').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);

    const failed = [ordersResult, shipmentsResult, documentsResult].find(result => result.error);
    if (failed?.error) {
      console.error('Receiving workspace data could not be loaded', failed.error);
      showToast('Could not load receiving data. Apply the latest database migration and try again.', 'error');
    }
    setOrders((ordersResult.data || []) as unknown as PurchaseOrder[]);
    setShipments((shipmentsResult.data || []) as unknown as Shipment[]);
    setDocuments((documentsResult.data || []) as unknown as ReceivingDocument[]);
    setProducts((productsResult.data || []) as Product[]);
    setSuppliers((suppliersResult.data || []) as Supplier[]);
    setLoading(false);
    setRefreshing(false);
  }, [showToast]);

  useEffect(() => { void loadData(); }, [loadData]);

  const pendingDocuments = documents.filter(document => document.status === 'pending_review');
  const openShipments = shipments.filter(shipment => !['received', 'cancelled'].includes(shipment.status));
  const ordersInProgress = orders.filter(order => !['fulfilled', 'cancelled'].includes(order.status));
  const filteredOrders = orders.filter(order => `${order.order_number} ${order.supplier?.name || ''}`.toLowerCase().includes(search.toLowerCase()));
  const filteredShipments = shipments.filter(shipment => `${shipment.asn_number} ${shipment.supplier?.name || ''} ${shipment.purchase_order?.order_number || ''}`.toLowerCase().includes(search.toLowerCase()));
  const filteredDocuments = documents.filter(document => `${document.file_name} ${document.invoice_number || ''} ${document.supplier?.name || ''}`.toLowerCase().includes(search.toLowerCase()));

  const currentMonthReceipts = useMemo(() => documents.filter(document => {
    if (document.status !== 'posted' || !document.posted_at) return false;
    const posted = new Date(document.posted_at);
    const now = new Date();
    return posted.getMonth() === now.getMonth() && posted.getFullYear() === now.getFullYear();
  }).length, [documents]);

  const resetOrderForm = () => {
    setOrderSupplierId(''); setOrderDate(''); setOrderNotes('');
    setOrderDraftLines([{ product_id: '', quantity: '1', unit_price: '' }]);
  };

  const openOrderForm = () => {
    resetOrderForm();
    setOrderModalOpen(true);
  };

  const updateOrderLine = (index: number, field: keyof DraftLine, value: string) => {
    setOrderDraftLines(current => current.map((line, i) => {
      if (i !== index) return line;
      if (field === 'product_id') {
        const product = products.find(candidate => candidate.id === value);
        return { ...line, product_id: value, unit_price: product ? String(product.buying_price) : line.unit_price };
      }
      return { ...line, [field]: value };
    }));
  };

  const handleCreateOrder = async () => {
    if (!orderSupplierId || orderDraftLines.length === 0 || orderDraftLines.some(line => !line.product_id || Number(line.quantity) <= 0 || Number(line.unit_price) < 0 || line.unit_price === '')) {
      showToast('Select a supplier and complete each product, quantity, and cost.', 'error');
      return;
    }
    setSavingOrder(true);
    const { error } = await supabase.rpc('create_supplier_purchase_order', {
      p_order_number: makeNumber('PO'),
      p_supplier_id: orderSupplierId,
      p_expected_delivery: orderDate || null,
      p_notes: orderNotes || null,
      p_lines: orderDraftLines.map(line => ({ product_id: line.product_id, quantity_ordered: Number(line.quantity), unit_price: Number(line.unit_price) })),
    });
    if (error) showToast(error.message, 'error');
    else {
      showToast('Purchase order created as a draft', 'success');
      setOrderModalOpen(false);
      setTab('orders');
      await loadData(true);
    }
    setSavingOrder(false);
  };

  const updateOrderStatus = async (order: PurchaseOrder, status: OrderStatus) => {
    const now = new Date().toISOString();
    const update = status === 'approved'
      ? { status, approved_at: now, approved_by: (await supabase.auth.getUser()).data.user?.id || null, updated_at: now }
      : status === 'sent' ? { status, sent_at: now, updated_at: now } : { status, updated_at: now };
    const { error } = await supabase.from('supplier_purchase_orders').update(update).eq('id', order.id);
    if (error) showToast(error.message, 'error');
    else { showToast(`Order ${order.order_number} ${status === 'sent' ? 'marked as sent' : status === 'approved' ? 'approved' : 'updated'}`, 'success'); await loadData(true); }
  };

  const eligibleOrders = orders.filter(order => ['approved', 'sent', 'acknowledged', 'partially_fulfilled'].includes(order.status));
  const selectedShipmentOrder = orders.find(order => order.id === shipmentOrderId);

  const openShipmentForm = (order?: PurchaseOrder) => {
    const selected = order || eligibleOrders[0];
    setShipmentOrderId(selected?.id || '');
    setShipmentNumber(makeNumber('ASN'));
    setShipmentDate(''); setVehicleReg(''); setDriverName(''); setShipmentNotes('');
    setShipmentDraftLines(selected?.lines.map(line => ({
      purchase_order_line_id: line.id,
      quantity: String(Math.max(0, Number(line.quantity_ordered) - Number(line.quantity_received))),
    })) || []);
    setShipmentModalOpen(true);
  };

  const selectShipmentOrder = (orderId: string) => {
    setShipmentOrderId(orderId);
    const order = orders.find(candidate => candidate.id === orderId);
    setShipmentDraftLines(order?.lines.map(line => ({
      purchase_order_line_id: line.id,
      quantity: String(Math.max(0, Number(line.quantity_ordered) - Number(line.quantity_received))),
    })) || []);
  };

  const handleCreateShipment = async () => {
    const lines = shipmentDraftLines.filter(line => Number(line.quantity) > 0);
    if (!shipmentOrderId || !shipmentNumber.trim() || lines.length === 0) {
      showToast('Select an approved order and enter at least one shipment quantity.', 'error');
      return;
    }
    setSavingShipment(true);
    const { error } = await supabase.rpc('create_supplier_asn', {
      p_asn_number: shipmentNumber,
      p_purchase_order_id: shipmentOrderId,
      p_expected_arrival: shipmentDate || null,
      p_vehicle_reg: vehicleReg || null,
      p_driver_name: driverName || null,
      p_notes: shipmentNotes || null,
      p_lines: lines.map(line => ({ purchase_order_line_id: line.purchase_order_line_id, quantity_expected: Number(line.quantity) })),
    });
    if (error) showToast(error.message, 'error');
    else {
      showToast('Inbound shipment added', 'success');
      setShipmentModalOpen(false);
      setTab('shipments');
      await loadData(true);
    }
    setSavingShipment(false);
  };

  const updateShipmentStatus = async (shipment: Shipment, status: AsnStatus) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('supplier_asns').update({
      status,
      actual_arrival_at: status === 'arrived' ? now : shipment.actual_arrival_at,
      updated_at: now,
    }).eq('id', shipment.id);
    if (error) showToast(error.message, 'error');
    else { showToast(`${shipment.asn_number} marked ${shipmentStatusLabel(status).toLowerCase()}`, 'success'); await loadData(true); }
  };

  const resetUpload = () => {
    setUploadSupplierId(''); setUploadAsnId(''); setDocumentType('delivery_note');
    setInvoiceNumber(''); setUploadNotes(''); setUploadFile(null);
  };

  const openUploadForm = (shipment?: Shipment) => {
    resetUpload();
    if (shipment) { setUploadSupplierId(shipment.supplier_id); setUploadAsnId(shipment.id); }
    setUploadModalOpen(true);
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadSupplierId) { showToast('Choose a supplier and attach a delivery document.', 'error'); return; }
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(uploadFile.type)) { showToast('Upload a PDF, JPG, PNG, or WebP file.', 'error'); return; }
    if (uploadFile.size > 20 * 1024 * 1024) { showToast('Files must be 20 MB or smaller.', 'error'); return; }
    if (!await hasValidFileSignature(uploadFile)) { showToast('The file contents do not match its selected document type.', 'error'); return; }
    const tenantId = getActiveTenantId();
    if (!tenantId) { showToast('Select a business workspace before uploading documents.', 'error'); return; }

    setUploading(true);
    const folder = crypto.randomUUID();
    const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'delivery-document';
    const path = `${tenantId}/${folder}/${safeName}`;
    const { error: storageError } = await supabase.storage.from('receiving-documents').upload(path, uploadFile, {
      cacheControl: '3600', upsert: false, contentType: uploadFile.type,
    });
    if (storageError) {
      showToast(storageError.message, 'error'); setUploading(false); return;
    }
    const { error: insertError } = await supabase.from('receiving_documents').insert({
      supplier_id: uploadSupplierId,
      asn_id: uploadAsnId || null,
      document_type: documentType,
      channel: 'web',
      status: 'pending_review',
      invoice_number: invoiceNumber.trim() || null,
      storage_path: path,
      file_name: uploadFile.name,
      mime_type: uploadFile.type,
      size_bytes: uploadFile.size,
      notes: uploadNotes.trim() || null,
    });
    if (insertError) {
      await supabase.storage.from('receiving-documents').remove([path]);
      showToast(insertError.message, 'error');
    } else {
      showToast('Document uploaded to the review queue', 'success');
      setUploadModalOpen(false);
      setTab('documents');
      await loadData(true);
    }
    setUploading(false);
  };

  const startReview = async (document: ReceivingDocument) => {
    setReviewDocument(document);
    setDocumentUrl('');
    const [{ data: lines, error: lineError }, { data: signed, error: signedError }] = await Promise.all([
      supabase.from('receiving_document_lines').select('*').eq('document_id', document.id).order('line_no'),
      supabase.storage.from('receiving-documents').createSignedUrl(document.storage_path, 300),
    ]);
    if (lineError) showToast(lineError.message, 'error');
    if (signedError) showToast('Document preview is unavailable. You can still review its details.', 'error');
    if (signed?.signedUrl) setDocumentUrl(signed.signedUrl);
    const savedLines = (lines || []) as ReceiptLine[];
    setReviewLines(savedLines.length ? savedLines.map(line => ({
      product_id: line.product_id,
      quantity: String(line.quantity_received),
      unit_price: String(line.unit_price),
      asn_line_id: line.asn_line_id || '',
      purchase_order_line_id: line.purchase_order_line_id || '',
    })) : [{ product_id: '', quantity: '1', unit_price: '', asn_line_id: '', purchase_order_line_id: '' }]);
  };

  const updateReviewLine = (index: number, field: keyof ReviewDraftLine, value: string) => {
    setReviewLines(current => current.map((line, i) => {
      if (i !== index) return line;
      if (field === 'product_id') {
        const matching = shipments.find(shipment => shipment.id === reviewDocument?.asn_id)?.lines.filter(asnLine => asnLine.product_id === value) || [];
        const line = matching.find(candidate => Number(candidate.quantity_received) < Number(candidate.quantity_expected)) || matching[0];
        return {
          ...line,
          product_id: value,
          unit_price: line ? String(line.unit_price) : products.find(product => product.id === value) ? String(products.find(product => product.id === value)!.buying_price) : '',
          asn_line_id: line?.id || '',
          purchase_order_line_id: line?.purchase_order_line_id || '',
          quantity: line ? String(Math.max(0, Number(line.quantity_expected) - Number(line.quantity_received)) || 1) : '1',
        };
      }
      return { ...line, [field]: value };
    }));
  };

  const reviewShipment = shipments.find(shipment => shipment.id === reviewDocument?.asn_id);
  const reviewTotal = reviewLines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0), 0);

  const saveReview = async () => {
    if (!reviewDocument) return;
    if (reviewLines.length === 0 || reviewLines.some(line => !line.product_id || Number(line.quantity) <= 0 || line.unit_price === '' || Number(line.unit_price) < 0)) {
      showToast('Complete each product, received quantity, and unit cost.', 'error');
      return;
    }
    setReviewSaving(true);
    const { error } = await supabase.rpc('save_receiving_document_review', {
      p_document_id: reviewDocument.id,
      p_lines: reviewLines.map(line => ({
        product_id: line.product_id,
        quantity_received: Number(line.quantity),
        unit_price: Number(line.unit_price),
        asn_line_id: line.asn_line_id || null,
      })),
    });
    if (error) showToast(error.message, 'error');
    else { showToast('Review details saved', 'success'); setReviewDocument(null); await loadData(true); }
    setReviewSaving(false);
  };

  const postDocument = async () => {
    if (!reviewDocument) return;
    if (reviewLines.length === 0 || reviewLines.some(line => !line.product_id || Number(line.quantity) <= 0 || line.unit_price === '' || Number(line.unit_price) < 0)) {
      showToast('Complete each product, received quantity, and unit cost before posting.', 'error');
      return;
    }
    setPosting(true);
    const { error: reviewError } = await supabase.rpc('save_receiving_document_review', {
      p_document_id: reviewDocument.id,
      p_lines: reviewLines.map(line => ({
        product_id: line.product_id,
        quantity_received: Number(line.quantity),
        unit_price: Number(line.unit_price),
        asn_line_id: line.asn_line_id || null,
      })),
    });
    if (reviewError) {
      showToast(reviewError.message, 'error');
      setPosting(false);
      return;
    }
    const { data, error } = await supabase.rpc('post_receiving_document', { p_document_id: reviewDocument.id });
    if (error) showToast(error.message, 'error');
    else {
      showToast(`Receipt posted. Stock and purchase ${String(data).slice(0, 8)} were updated.`, 'success');
      setReviewDocument(null);
      await loadData(true);
    }
    setPosting(false);
  };

  const rejectDocument = async (document: ReceivingDocument) => {
    const { error } = await supabase.from('receiving_documents').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', document.id);
    if (error) showToast(error.message, 'error');
    else { showToast('Document rejected', 'info'); await loadData(true); }
  };

  const tabs: { id: Tab; label: string; icon: typeof Package; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: Package },
    { id: 'orders', label: 'Purchase orders', icon: ClipboardCheck, count: ordersInProgress.length },
    { id: 'shipments', label: 'Inbound shipments', icon: Truck, count: openShipments.length },
    { id: 'documents', label: 'Document review', icon: FileText, count: pendingDocuments.length },
  ];

  if (loading) {
    return <div className="flex min-h-[55vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <PageHeader
        title="Receiving"
        subtitle="Track supplier orders, inbound deliveries, and stock receipts in one place."
        actions={isAdmin && <button onClick={() => openUploadForm()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"><Upload size={16} /> Upload document</button>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard icon={ClipboardCheck} label="Orders in progress" value={ordersInProgress.length} detail={`${orders.filter(order => order.status === 'draft').length} drafts awaiting action`} tone="blue" />
        <MetricCard icon={Truck} label="Inbound shipments" value={openShipments.length} detail="Deliveries still on the way" tone="amber" />
        <MetricCard icon={FileText} label="Needs review" value={pendingDocuments.length} detail="Uploaded supplier documents" tone="rose" />
        <MetricCard icon={CheckCircle2} label="Receipts this month" value={currentMonthReceipts} detail="Posted to inventory" tone="green" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-200/50">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(item => {
            const Icon = item.icon;
            const active = tab === item.id;
            return <button key={item.id} onClick={() => { setTab(item.id); setSearch(''); }} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}>
              <Icon size={16} />{item.label}
              {item.count !== undefined && item.count > 0 && <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] ${active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>{item.count}</span>}
            </button>;
          })}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div><h2 className="text-base font-bold text-slate-900">Work queue</h2><p className="mt-0.5 text-sm text-slate-500">The next supplier actions for your team.</p></div>
              <button onClick={() => void loadData(true)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Refresh receiving data"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
            </div>
            <div className="divide-y divide-slate-100">
              {pendingDocuments.slice(0, 3).map(document => <QueueRow key={document.id} icon={FileText} title={document.file_name} subtitle={`${document.supplier?.name || 'Supplier'} · ${formatDateTime(document.created_at)}`} badge="Review document" tone="rose" onClick={() => void startReview(document)} />)}
              {openShipments.filter(shipment => shipment.status === 'arrived').slice(0, 2).map(shipment => <QueueRow key={shipment.id} icon={Truck} title={`${shipment.asn_number} has arrived`} subtitle={`${shipment.supplier?.name || 'Supplier'} · ${shipment.purchase_order?.order_number || 'No PO linked'}`} badge="Receive items" tone="amber" onClick={() => openUploadForm(shipment)} />)}
              {orders.filter(order => order.status === 'draft').slice(0, 2).map(order => <QueueRow key={order.id} icon={ClipboardCheck} title={`${order.order_number} is a draft`} subtitle={`${order.supplier?.name || 'Supplier'} · ${order.lines.length} products · ${formatCurrency(order.total_amount)}`} badge="Approve order" tone="blue" onClick={() => setTab('orders')} />)}
              {pendingDocuments.length === 0 && openShipments.every(shipment => shipment.status !== 'arrived') && orders.every(order => order.status !== 'draft') && <div className="p-8 text-center"><CheckCircle2 className="mx-auto text-emerald-500" size={28} /><p className="mt-3 text-sm font-semibold text-slate-800">You’re all caught up</p><p className="mt-1 text-sm text-slate-500">New deliveries and documents will show up here.</p></div>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
            <div className="flex items-start justify-between"><div><h2 className="text-base font-bold text-slate-900">Start a workflow</h2><p className="mt-1 text-sm text-slate-500">Move supplier stock into your inventory.</p></div><div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><ArrowDownToLine size={20} /></div></div>
            <div className="mt-5 space-y-2.5">
              <ActionCard icon={ClipboardCheck} title="Create purchase order" detail="Plan what you need from a supplier" onClick={openOrderForm} disabled={!isAdmin} />
              <ActionCard icon={Truck} title="Register inbound shipment" detail="Link an ASN to an approved order" onClick={() => openShipmentForm()} disabled={!isAdmin || eligibleOrders.length === 0} />
              <ActionCard icon={Upload} title="Upload delivery document" detail="Add an invoice, delivery note, or packing slip" onClick={() => openUploadForm()} disabled={!isAdmin} />
            </div>
            {!isAdmin && <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">Receiving changes are available to business administrators.</p>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 xl:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-bold text-slate-900">Latest purchase orders</h2><p className="mt-0.5 text-sm text-slate-500">Recent activity across your suppliers.</p></div><button onClick={() => setTab('orders')} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800">All orders <ArrowRight size={15} /></button></div>
            {orders.length === 0 ? <div className="p-6 text-sm text-slate-500">Purchase orders will appear here after you create the first one.</div> : <div className="divide-y divide-slate-100 md:grid md:grid-cols-2 md:divide-y-0">{orders.slice(0, 4).map(order => <div key={order.id} className="flex items-center justify-between gap-4 p-4 md:border-b md:border-slate-100"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{order.order_number}<span className="ml-2 font-normal text-slate-500">{order.supplier?.name}</span></p><p className="mt-1 text-xs text-slate-500">{order.lines.length} products · {order.expected_delivery ? `Expected ${formatDate(order.expected_delivery)}` : 'No delivery date'}</p></div><div className="shrink-0 text-right"><StatusBadge tone={orderTone(order.status)}>{orderStatusLabel(order.status)}</StatusBadge><p className="mt-1.5 text-sm font-semibold text-slate-800">{formatCurrency(order.total_amount)}</p></div></div>)}</div>}
          </section>
        </div>
      )}

      {tab !== 'overview' && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${tab === 'orders' ? 'purchase orders' : tab === 'shipments' ? 'shipments' : 'documents'}...`} /></div>
        {isAdmin && <button onClick={() => tab === 'orders' ? openOrderForm() : tab === 'shipments' ? openShipmentForm() : openUploadForm()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"><Plus size={16} />{tab === 'orders' ? 'New purchase order' : tab === 'shipments' ? 'Register shipment' : 'Upload document'}</button>}
      </div>}

      {tab === 'orders' && <OrdersPanel orders={filteredOrders} isAdmin={isAdmin} onApprove={order => void updateOrderStatus(order, 'approved')} onSend={order => void updateOrderStatus(order, 'sent')} onCreateShipment={openShipmentForm} />}
      {tab === 'shipments' && <ShipmentsPanel shipments={filteredShipments} isAdmin={isAdmin} onStatus={updateShipmentStatus} onUpload={openUploadForm} />}
      {tab === 'documents' && <DocumentsPanel documents={filteredDocuments} isAdmin={isAdmin} onReview={startReview} onReject={rejectDocument} />}

      <Modal open={orderModalOpen} onClose={() => setOrderModalOpen(false)} title="Create purchase order" size="xl">
        <div className="space-y-5">
          <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">Create an order from products already in your hardware catalogue. Approval and supplier dispatch are recorded separately.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier"><select className={inputClass} value={orderSupplierId} onChange={event => setOrderSupplierId(event.target.value)}><option value="">Select supplier...</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
            <Field label="Expected delivery"><input className={inputClass} type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></Field>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between bg-slate-50 px-4 py-3"><p className="text-sm font-bold text-slate-800">Order lines</p><button onClick={() => setOrderDraftLines(current => [...current, { product_id: '', quantity: '1', unit_price: '' }])} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700"><Plus size={15} /> Add item</button></div>
            <div className="divide-y divide-slate-100">{orderDraftLines.map((line, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_82px_120px_34px] items-center gap-2 p-3 sm:gap-3 sm:p-4"><select className={inputClass} value={line.product_id} onChange={event => updateOrderLine(index, 'product_id', event.target.value)}><option value="">Select product...</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input className={inputClass} type="number" min="0.01" step="0.01" aria-label="Quantity ordered" value={line.quantity} onChange={event => updateOrderLine(index, 'quantity', event.target.value)} /><input className={inputClass} type="number" min="0" step="0.01" aria-label="Unit price" placeholder="Unit cost" value={line.unit_price} onChange={event => updateOrderLine(index, 'unit_price', event.target.value)} /><button onClick={() => setOrderDraftLines(current => current.filter((_, i) => i !== index))} disabled={orderDraftLines.length === 1} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" aria-label="Remove line"><X size={16} /></button></div>)}</div>
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3"><span className="text-sm font-semibold text-slate-600">Order total</span><span className="text-base font-extrabold text-slate-900">{formatCurrency(orderDraftLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0))}</span></div>
          </div>
          <Field label="Order notes"><textarea className={inputClass} rows={2} value={orderNotes} onChange={event => setOrderNotes(event.target.value)} placeholder="Delivery instructions or supplier notes" /></Field>
          <ModalActions onCancel={() => setOrderModalOpen(false)} onSave={handleCreateOrder} saving={savingOrder} label="Save draft" />
        </div>
      </Modal>

      <Modal open={shipmentModalOpen} onClose={() => setShipmentModalOpen(false)} title="Register inbound shipment" size="xl">
        <div className="space-y-5">
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Record what the supplier says is on the way. Received quantities will be confirmed from the delivery document.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Purchase order"><select className={inputClass} value={shipmentOrderId} onChange={event => selectShipmentOrder(event.target.value)}><option value="">Select approved order...</option>{eligibleOrders.map(order => <option key={order.id} value={order.id}>{order.order_number} · {order.supplier?.name}</option>)}</select></Field>
            <Field label="Shipment / ASN number"><input className={inputClass} value={shipmentNumber} onChange={event => setShipmentNumber(event.target.value)} /></Field>
            <Field label="Expected arrival"><input className={inputClass} type="date" value={shipmentDate} onChange={event => setShipmentDate(event.target.value)} /></Field>
            <Field label="Vehicle registration"><input className={inputClass} value={vehicleReg} onChange={event => setVehicleReg(event.target.value)} placeholder="Optional" /></Field>
            <Field label="Driver name"><input className={inputClass} value={driverName} onChange={event => setDriverName(event.target.value)} placeholder="Optional" /></Field>
            <Field label="Notes"><input className={inputClass} value={shipmentNotes} onChange={event => setShipmentNotes(event.target.value)} placeholder="Optional" /></Field>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_112px] gap-3 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500"><span>Order product</span><span>Remaining</span><span>Expected qty</span></div>
            {!selectedShipmentOrder ? <p className="p-5 text-sm text-slate-500">Choose an approved purchase order to prepare shipment lines.</p> : selectedShipmentOrder.lines.map((line, index) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_120px_112px] items-center gap-3 border-t border-slate-100 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{line.product?.name || line.description}</p><p className="text-xs text-slate-500">Ordered {line.quantity_ordered} {line.unit || line.product?.unit || ''}</p></div><span className="text-sm text-slate-500">{Math.max(0, Number(line.quantity_ordered) - Number(line.quantity_received))}</span><input className={inputClass} type="number" min="0" step="0.01" value={shipmentDraftLines[index]?.quantity || '0'} onChange={event => setShipmentDraftLines(current => current.map((draft, i) => i === index ? { ...draft, quantity: event.target.value } : draft))} aria-label={`Expected quantity for ${line.product?.name || line.description}`} /></div>)}
          </div>
          <ModalActions onCancel={() => setShipmentModalOpen(false)} onSave={handleCreateShipment} saving={savingShipment} label="Save shipment" />
        </div>
      </Modal>

      <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Upload supplier document" size="lg">
        <div className="space-y-4">
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Files are stored privately in this business workspace. A reviewer will match the document lines to your product catalogue before stock is posted.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier"><select className={inputClass} value={uploadSupplierId} onChange={event => setUploadSupplierId(event.target.value)}><option value="">Select supplier...</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
            <Field label="Inbound shipment (optional)"><select className={inputClass} value={uploadAsnId} onChange={event => { const id = event.target.value; setUploadAsnId(id); const shipment = shipments.find(candidate => candidate.id === id); if (shipment) setUploadSupplierId(shipment.supplier_id); }}><option value="">No shipment link</option>{shipments.filter(shipment => shipment.status !== 'received').map(shipment => <option key={shipment.id} value={shipment.id}>{shipment.asn_number} · {shipment.supplier?.name}</option>)}</select></Field>
            <Field label="Document type"><select className={inputClass} value={documentType} onChange={event => setDocumentType(event.target.value)}><option value="delivery_note">Delivery note</option><option value="invoice">Invoice</option><option value="packing_slip">Packing slip</option><option value="receipt">Receipt</option><option value="credit_note">Credit note</option><option value="unknown">Other / unknown</option></select></Field>
            <Field label="Invoice / reference number"><input className={inputClass} value={invoiceNumber} onChange={event => setInvoiceNumber(event.target.value)} placeholder="Optional" /></Field>
          </div>
          <label className="block"><span className={labelClass}>Document file</span><span className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-8 text-center transition ${uploadFile ? 'border-blue-300 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50'}`}><FileImage className="text-blue-600" size={27} /><span className="mt-3 text-sm font-semibold text-slate-800">{uploadFile?.name || 'Choose a PDF or photo'}</span><span className="mt-1 text-xs text-slate-500">PDF, JPG, PNG or WebP · up to 20 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={event => setUploadFile(event.target.files?.[0] || null)} /></span></label>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={uploadNotes} onChange={event => setUploadNotes(event.target.value)} placeholder="Optional context for the reviewer" /></Field>
          <ModalActions onCancel={() => setUploadModalOpen(false)} onSave={handleUpload} saving={uploading} label="Upload to review" icon={<Upload size={15} />} />
        </div>
      </Modal>

      <Modal open={!!reviewDocument} onClose={() => setReviewDocument(null)} title="Review delivery document" size="xl">
        {reviewDocument && <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3"><div className="rounded-lg bg-blue-50 p-2 text-blue-700">{reviewDocument.mime_type === 'application/pdf' ? <FileText size={18} /> : <FileImage size={18} />}</div><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{reviewDocument.file_name}</p><p className="text-xs text-slate-500">{(reviewDocument.size_bytes / (1024 * 1024)).toFixed(2)} MB · {reviewDocument.document_type.replace('_', ' ')}</p></div></div>
              {documentUrl ? reviewDocument.mime_type === 'application/pdf' ? <iframe src={documentUrl} title="Uploaded supplier document" className="h-[420px] w-full bg-white" /> : <div className="flex h-[420px] items-center justify-center p-4"><img src={documentUrl} alt="Uploaded supplier document" className="max-h-full max-w-full rounded-lg object-contain shadow-sm" /></div> : <div className="flex h-48 items-center justify-center text-sm text-slate-500">Loading private preview…</div>}
            </div>
            <div className="grid grid-cols-2 gap-3"><InfoTile label="Supplier" value={reviewDocument.supplier?.name || 'Unknown'} /><InfoTile label="ASN" value={reviewShipment?.asn_number || 'Not linked'} /><InfoTile label="Invoice ref" value={reviewDocument.invoice_number || 'Not provided'} /><InfoTile label="Uploaded" value={formatDateTime(reviewDocument.created_at)} /></div>
            {reviewDocument.notes && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{reviewDocument.notes}</p>}
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900">Match received lines</h3><p className="mt-1 text-xs leading-5 text-slate-500">Enter quantities from the document and connect each line to a catalogue product.</p></div><StatusBadge tone="amber">Manual review</StatusBadge></div>
            {reviewShipment && <div className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><AlertCircle size={16} className="shrink-0" /><span>Linked to {reviewShipment.asn_number}. Posted quantities update its receipt progress and the purchase order.</span></div>}
            {reviewDocument.document_type === 'credit_note' && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>Credit notes do not add stock. This document can be reviewed, but it must be handled through the supplier credit workflow.</span></div>}
            <div className="space-y-3">{reviewLines.map((line, index) => {
              const selectedProduct = products.find(product => product.id === line.product_id);
              const matchingAsnLines = reviewShipment?.lines.filter(asnLine => asnLine.product_id === line.product_id) || [];
              return <div key={index} className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Document line {index + 1}</p><button onClick={() => setReviewLines(current => current.filter((_, i) => i !== index))} disabled={reviewLines.length === 1} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" aria-label="Remove receipt line"><X size={15} /></button></div>
                <div className="space-y-3"><Field label="Catalogue product"><select className={inputClass} value={line.product_id} onChange={event => updateReviewLine(index, 'product_id', event.target.value)}><option value="">Select matched product...</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}{product.catalog_sku ? ` · ${product.catalog_sku}` : ''}</option>)}</select></Field>
                  {matchingAsnLines.length > 1 && <Field label="Shipment line"><select className={inputClass} value={line.asn_line_id} onChange={event => { const chosen = matchingAsnLines.find(candidate => candidate.id === event.target.value); setReviewLines(current => current.map((draft, i) => i === index ? { ...draft, asn_line_id: chosen?.id || '', purchase_order_line_id: chosen?.purchase_order_line_id || '' } : draft)); }}><option value="">Select shipment line...</option>{matchingAsnLines.map(asnLine => <option key={asnLine.id} value={asnLine.id}>Expected {asnLine.quantity_expected} {asnLine.unit || ''} · line {asnLine.line_no}</option>)}</select></Field>}
                  <div className="grid grid-cols-2 gap-3"><Field label={`Received quantity${selectedProduct ? ` (${selectedProduct.unit})` : ''}`}><input className={inputClass} type="number" min="0.01" step="0.01" value={line.quantity} onChange={event => updateReviewLine(index, 'quantity', event.target.value)} /></Field><Field label="Unit cost"><input className={inputClass} type="number" min="0" step="0.01" value={line.unit_price} onChange={event => updateReviewLine(index, 'unit_price', event.target.value)} /></Field></div>
                  <p className="text-right text-xs font-semibold text-slate-500">Line total <span className="ml-1 text-sm text-slate-900">{formatCurrency(Number(line.quantity || 0) * Number(line.unit_price || 0))}</span></p>
                </div>
              </div>;
            })}</div>
            <button onClick={() => setReviewLines(current => [...current, { product_id: '', quantity: '1', unit_price: '', asn_line_id: '', purchase_order_line_id: '' }])} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus size={15} /> Add line</button>
            <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white"><span className="text-sm text-slate-300">Receipt value · posted on credit</span><span className="font-bold">{formatCurrency(reviewTotal)}</span></div>
            <div className="grid gap-2 sm:grid-cols-2"><button onClick={() => void saveReview()} disabled={reviewSaving || posting} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{reviewSaving ? <RefreshCw className="animate-spin" size={16} /> : <ShieldCheck size={16} />}{reviewSaving ? 'Saving…' : 'Save review'}</button><button onClick={() => void postDocument()} disabled={posting || reviewSaving || reviewDocument.document_type === 'credit_note' || reviewLines.length === 0 || reviewLines.some(line => !line.product_id)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50">{posting ? <RefreshCw className="animate-spin" size={16} /> : <Check size={16} />}{posting ? 'Posting…' : reviewDocument.document_type === 'credit_note' ? 'Credit note held' : 'Approve & post stock'}</button></div>
            <p className="text-[11px] leading-5 text-slate-400">Posting creates the supplier purchase, stock movements, and shipment progress in one database transaction. This version requires a person to match lines; OCR extraction is not configured.</p>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof Package; label: string; value: number; detail: string; tone: 'blue' | 'amber' | 'rose' | 'green' }) {
  const tones = { blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', green: 'bg-emerald-50 text-emerald-700' };
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/40 sm:p-5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">{value}</p></div><span className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon size={18} /></span></div><p className="mt-3 truncate text-xs text-slate-500">{detail}</p></div>;
}

function QueueRow({ icon: Icon, title, subtitle, badge, tone, onClick }: { icon: typeof Package; title: string; subtitle: string; badge: string; tone: 'blue' | 'amber' | 'rose'; onClick: () => void }) {
  return <button onClick={onClick} className="group flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50"><span className={`rounded-xl p-2.5 ${tone === 'rose' ? 'bg-rose-50 text-rose-600' : tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800">{title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{subtitle}</span></span><span className="hidden shrink-0 sm:block"><StatusBadge tone={tone}>{badge}</StatusBadge></span><ChevronRight className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" size={17} /></button>;
}

function ActionCard({ icon: Icon, title, detail, onClick, disabled }: { icon: typeof Package; title: string; detail: string; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3.5 text-left transition hover:border-blue-200 hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-45"><span className="rounded-lg bg-slate-100 p-2.5 text-slate-700 transition group-hover:bg-white group-hover:text-blue-700"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">{title}</span><span className="mt-0.5 block text-xs text-slate-500">{detail}</span></span><ArrowRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /></button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className={labelClass}>{label}</span>{children}</label>;
}

function ModalActions({ onCancel, onSave, saving, label, icon }: { onCancel: () => void; onSave: () => void; saving: boolean; label: string; icon?: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button onClick={onCancel} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button onClick={() => void onSave()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">{saving ? <RefreshCw size={15} className="animate-spin" /> : icon}{saving ? 'Saving…' : label}</button></div>;
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 truncate text-xs font-semibold text-slate-800">{value}</p></div>;
}

function PanelFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">{children}</div>;
}

function OrdersPanel({ orders, isAdmin, onApprove, onSend, onCreateShipment }: { orders: PurchaseOrder[]; isAdmin: boolean; onApprove: (order: PurchaseOrder) => void; onSend: (order: PurchaseOrder) => void; onCreateShipment: (order: PurchaseOrder) => void }) {
  if (orders.length === 0) return <PanelFrame><EmptyState icon={ClipboardCheck} title="No purchase orders found" description="Create a supplier order to plan and track your next inventory delivery." /></PanelFrame>;
  return <PanelFrame><div className="hidden grid-cols-[1.2fr_1fr_0.75fr_0.7fr_0.7fr] gap-4 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 lg:grid"><span>Purchase order</span><span>Products</span><span>Expected</span><span>Status</span><span className="text-right">Order total</span></div><div className="divide-y divide-slate-100">{orders.map(order => <div key={order.id} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_0.75fr_0.7fr_0.7fr] lg:items-center lg:gap-4 lg:px-5"><div><p className="text-sm font-bold text-slate-900">{order.order_number}</p><p className="mt-0.5 text-xs text-slate-500">{order.supplier?.name || 'Supplier'} · Created {formatDate(order.created_at)}</p></div><div className="text-xs text-slate-600">{order.lines.slice(0, 2).map(line => line.product?.name || line.description).join(', ')}{order.lines.length > 2 ? ` +${order.lines.length - 2} more` : ''}<span className="ml-1 text-slate-400">({order.lines.length})</span></div><div className="text-xs text-slate-600">{order.expected_delivery ? formatDate(order.expected_delivery) : 'Not scheduled'}</div><div><StatusBadge tone={orderTone(order.status)}>{orderStatusLabel(order.status)}</StatusBadge></div><div className="flex items-center justify-between gap-3 lg:justify-end"><span className="text-sm font-bold text-slate-900">{formatCurrency(order.total_amount)}</span>{isAdmin && <div className="flex gap-1">{order.status === 'draft' && <button onClick={() => onApprove(order)} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">Approve</button>}{order.status === 'approved' && <button onClick={() => onSend(order)} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">Mark sent</button>}{['approved', 'sent', 'acknowledged', 'partially_fulfilled'].includes(order.status) && <button onClick={() => onCreateShipment(order)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700">ASN</button>}</div>}</div></div>)}</div></PanelFrame>;
}

function ShipmentsPanel({ shipments, isAdmin, onStatus, onUpload }: { shipments: Shipment[]; isAdmin: boolean; onStatus: (shipment: Shipment, status: AsnStatus) => void; onUpload: (shipment: Shipment) => void }) {
  if (shipments.length === 0) return <PanelFrame><EmptyState icon={Truck} title="No inbound shipments found" description="Create an ASN from an approved purchase order to prepare for a delivery." /></PanelFrame>;
  return <PanelFrame><div className="hidden grid-cols-[1.1fr_1fr_0.8fr_0.7fr_0.7fr] gap-4 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 lg:grid"><span>Shipment</span><span>Linked order</span><span>Expected arrival</span><span>Status</span><span className="text-right">Action</span></div><div className="divide-y divide-slate-100">{shipments.map(shipment => <div key={shipment.id} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1fr_0.8fr_0.7fr_0.7fr] lg:items-center lg:gap-4 lg:px-5"><div><p className="text-sm font-bold text-slate-900">{shipment.asn_number}</p><p className="mt-0.5 text-xs text-slate-500">{shipment.supplier?.name || 'Supplier'}{shipment.vehicle_reg ? ` · ${shipment.vehicle_reg}` : ''}</p></div><div><p className="text-xs font-semibold text-slate-700">{shipment.purchase_order?.order_number || 'No linked order'}</p><p className="mt-1 text-xs text-slate-500">{shipment.lines.length} shipment lines</p></div><div className="text-xs text-slate-600">{shipment.expected_arrival_date ? formatDate(shipment.expected_arrival_date) : 'Unscheduled'}</div><div><StatusBadge tone={shipmentTone(shipment.status)}>{shipmentStatusLabel(shipment.status)}</StatusBadge></div><div className="flex flex-wrap justify-start gap-1 lg:justify-end">{isAdmin && shipment.status === 'announced' && <button onClick={() => onStatus(shipment, 'in_transit')} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">In transit</button>}{isAdmin && ['announced', 'in_transit'].includes(shipment.status) && <button onClick={() => onStatus(shipment, 'arrived')} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100">Mark arrived</button>}{isAdmin && ['arrived', 'partially_received', 'receiving'].includes(shipment.status) && <button onClick={() => onUpload(shipment)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700">Receive</button>}</div></div>)}</div></PanelFrame>;
}

function DocumentsPanel({ documents, isAdmin, onReview, onReject }: { documents: ReceivingDocument[]; isAdmin: boolean; onReview: (document: ReceivingDocument) => void; onReject: (document: ReceivingDocument) => void }) {
  if (documents.length === 0) return <PanelFrame><EmptyState icon={FileText} title="No documents found" description="Upload a supplier invoice, delivery note, or packing slip to start a receipt review." /></PanelFrame>;
  return <PanelFrame><div className="hidden grid-cols-[1.3fr_0.9fr_0.65fr_0.65fr_0.8fr] gap-4 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500"><span>Document</span><span>Supplier / shipment</span><span>Received</span><span>Status</span><span className="text-right">Action</span></div><div className="divide-y divide-slate-100">{documents.map(document => <div key={document.id} className="grid gap-3 p-4 lg:grid-cols-[1.3fr_0.9fr_0.65fr_0.65fr_0.8fr] lg:items-center lg:gap-4 lg:px-5"><div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700">{document.mime_type === 'application/pdf' ? <FileText size={17} /> : <FileImage size={17} />}</span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{document.file_name}</p><p className="mt-0.5 truncate text-xs text-slate-500">{document.invoice_number ? `Ref ${document.invoice_number} · ` : ''}{document.document_type.replace('_', ' ')}</p></div></div><div><p className="text-xs font-semibold text-slate-700">{document.supplier?.name || 'Supplier'}</p><p className="mt-1 text-xs text-slate-500">{document.asn?.asn_number || 'No shipment linked'}</p></div><div className="text-xs text-slate-600">{formatDate(document.created_at)}</div><div><StatusBadge tone={document.status === 'posted' ? 'green' : document.status === 'rejected' ? 'rose' : 'amber'}>{document.status === 'pending_review' ? 'Needs review' : document.status === 'posted' ? 'Posted' : 'Rejected'}</StatusBadge></div><div className="flex items-center justify-between gap-2 lg:justify-end">{document.status === 'posted' ? <span className="text-xs text-slate-500">Stock updated</span> : document.status === 'rejected' ? <span className="text-xs text-slate-500">No stock posted</span> : isAdmin && <><button onClick={() => onReview(document)} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">Review</button><button onClick={() => onReject(document)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Reject document"><X size={15} /></button></>}</div></div>)}</div></PanelFrame>;
}
