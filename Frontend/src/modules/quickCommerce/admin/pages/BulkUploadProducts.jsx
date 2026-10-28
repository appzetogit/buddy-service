import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { adminApi } from '../services/adminApi';

// Mirrors Food admin's bulk-upload page, pointed at the Quick Commerce admin endpoints.
// Admin picks the seller first (QC products belong to one seller, unlike Food's per-row
// "Restaurant Name" column) and that sellerId is sent alongside the excel + images.
export default function BulkUploadProducts() {
  const navigate = useNavigate();
  const [sellerOptions, setSellerOptions] = useState([]);
  const [sellerId, setSellerId] = useState('');
  const [excelFile, setExcelFile] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await adminApi.getSellerOptions();
        const items =
          response?.data?.result?.items ||
          response?.data?.data?.items ||
          response?.data?.result ||
          [];
        const list = Array.isArray(items) ? items : [];
        setSellerOptions(
          list
            .map((seller) => ({
              id: String(seller._id || seller.id || ''),
              label: seller.shopName || seller.ownerName || 'Seller',
            }))
            .filter((seller) => seller.id)
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch (error) {
        toast.error('Failed to load sellers');
      }
    })();
  }, []);

  const downloadTemplate = async () => {
    try {
      setDownloadingTemplate(true);
      const response = await adminApi.getProductBulkTemplate();
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'product-bulk-upload-template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Failed to download template');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleBulkUpload = async (e) => {
    e.preventDefault();
    if (!sellerId) {
      toast.error('Please select a seller first');
      return;
    }
    if (!excelFile) {
      toast.error('Please select the filled excel file first');
      return;
    }

    setIsUploading(true);
    setBulkResult(null);

    try {
      const data = new FormData();
      data.append('sellerId', sellerId);
      data.append('file', excelFile);
      imageFiles.forEach((file) => data.append('images', file));

      const res = await adminApi.bulkUploadProductsExcel(data);
      const result = res?.data?.data || res?.data?.result || {};
      setBulkResult(result);
      if ((result.created || []).length > 0) {
        toast.success(`${result.created.length} product(s) created`);
      }
      if ((result.failed || []).length > 0) {
        toast.error(`${result.failed.length} row(s) failed — see details below`);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to upload and import products');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 pb-20 px-3.5 md:px-4 pt-4">
      <div className="flex items-center justify-between pb-2 border-b border-gray-200">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3.5 sm:p-5 space-y-4">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 tracking-tight">Bulk Product Upload</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pick a seller, fill an excel with their products (variants included) and upload it together with a folder of images.
          </p>
        </div>

        <form onSubmit={handleBulkUpload} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Seller</label>
            <select
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              disabled={isUploading}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-xs bg-white"
            >
              <option value="">Select seller</option>
              {sellerOptions.map((seller) => (
                <option key={seller.id} value={seller.id}>
                  {seller.label}
                </option>
              ))}
            </select>
          </div>

          <ol className="text-xs text-gray-600 list-decimal list-inside space-y-1 bg-gray-50 rounded-xl p-3.5 border border-gray-200">
            <li>Download the excel template below and fill one row per product.</li>
            <li>Header Category / Category / Subcategory must exactly match existing category names.</li>
            <li>Put every image referenced in the Images / Variant Images columns into one folder.</li>
            <li>Upload the filled excel and select that whole folder below.</li>
          </ol>

          <button
            type="button"
            onClick={downloadTemplate}
            disabled={downloadingTemplate}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-all disabled:opacity-50"
          >
            {downloadingTemplate ? 'Downloading…' : 'Download Excel Template'}
          </button>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Excel File (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
              className="text-xs w-full"
              disabled={isUploading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Images Folder ({imageFiles.length} selected)
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(e) => setImageFiles(Array.from(e.target.files || []))}
              className="text-xs w-full"
              disabled={isUploading}
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Pick the whole folder that has every image the excel refers to — all images inside are picked up automatically.
            </p>
          </div>

          {bulkResult && (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-xs">
              <div className="px-3 py-2 flex items-center justify-between bg-gray-50">
                <span className="font-medium text-gray-700">
                  {bulkResult.created?.length || 0} of {bulkResult.totalRows || 0} created
                </span>
              </div>
              {(bulkResult.created || []).map((row) => (
                <div key={row.id} className="px-3 py-2 text-green-700">
                  Row {row.row}: {row.name}
                </div>
              ))}
              {(bulkResult.failed || []).map((row, i) => (
                <div key={i} className="px-3 py-2 text-red-600">
                  Row {row.row}: {row.name || '—'} — {row.reason}
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={isUploading || !excelFile || !sellerId}
            className="w-full px-3 py-2.5 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            {isUploading ? 'Uploading…' : 'Upload & Import'}
          </button>
        </form>
      </div>
    </div>
  );
}
