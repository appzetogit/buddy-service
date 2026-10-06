import React, { useState, useMemo, useEffect, useRef } from "react";
import Button from "@shared/components/ui/Button";
import Badge from "@shared/components/ui/Badge";
import {
  HiOutlineArrowLeft,
  HiOutlineCube,
  HiOutlineTag,
  HiOutlineSwatch,
  HiOutlineFolderOpen,
  HiOutlineArrowPath,
  HiOutlineTrash,
  HiOutlinePlus,
  HiOutlineSquaresPlus,
  HiOutlineCurrencyRupee,
} from "react-icons/hi2";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { sellerApi } from "../services/sellerApi";
import { useAuthStore } from "@/core/auth/auth.store";
import {
  clearSellerProductAddDraft,
  draftMatchesSeller,
  hydrateProductFormFromDraft,
  newProductPublishId,
  readSellerProductAddDraft,
  serializeProductFormForDraft,
  writeSellerProductAddDraft,
} from "../utils/productAddDraft";
import VariantImageSlots from "@/shared/components/products/VariantImageSlots";
import {
  MAX_PRODUCT_VARIANTS,
  MAX_VARIANT_IMAGES,
  MIN_VARIANT_IMAGES,
  countVariantMedia,
  appendVariantImageFiles,
  serializeVariantsForApi,
} from "@/shared/utils/variantMedia";


const normalizeSlugKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");


const toLocalIsoDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const TODAY_ISO = toLocalIsoDate();
const TOMORROW_ISO = (() => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return toLocalIsoDate(next);
})();

const DEFAULT_PRODUCT_FORM = {
  name: "",
  slug: "",
  sku: "",
  description: "",
  price: "",
  salePrice: "",
  packingFee: "",
  stock: "",
  lowStockAlert: 5,
  category: "",
  subcategory: "",
  header: "",
  status: "active",
  tags: "",
  weight: "",
  brand: "",

  variants: [{ id: Date.now(), name: "", price: "", salePrice: "", stock: "", sku: "", media: [] }],
};

const getAddProductTabs = () => [
  { id: "general", label: "General Info" },
  { id: "variants", label: "Item Variants" },
  { id: "category", label: "Groups" },
];

const AddProduct = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore(state => state.user);
  const sellerId = String(user?._id || user?.id || user?.phone || "").trim();
  const productTabs = useMemo(
    () => getAddProductTabs(),
    [],
  );
  const [modalTab, setModalTab] = useState("general");
  const [isSaving, setIsSaving] = useState(false);
  const saveLockRef = useRef(false);
  const [clientRequestId, setClientRequestId] = useState("");
  const [submitStatus, setSubmitStatus] = useState("idle");
  const [addMethod, setAddMethod] = useState(null); // 'single', 'bulk', or null
  const [draftReady, setDraftReady] = useState(false);
  const draftHydratedRef = useRef(false);

  const validateCurrentTab = () => {
    if (modalTab === "general") {
      if (!String(formData.name || "").trim()) {
        toast.error("Please fill in the Product Title");
        return false;
      }
    }


    if (modalTab === "variants") {
      const variants = Array.isArray(formData.variants) ? formData.variants : [];
      if (!variants.length) {
        toast.error("Add at least one variant with price and stock");
        return false;
      }
      for (const variant of variants) {
        if (!String(variant.name || "").trim()) {
          toast.error("Each variant needs a name (e.g. 1kg, 500ml)");
          return false;
        }
        if (!variant.price || Number(variant.price) < 1) {
          toast.error(`Variant "${variant.name}": price must be at least ₹1`);
          return false;
        }
        if (variant.stock === "" || variant.stock == null || Number(variant.stock) < 0) {
          toast.error(`Variant "${variant.name}": stock is required`);
          return false;
        }
        if (variant.salePrice && Number(variant.salePrice) > 0 && Number(variant.salePrice) > Number(variant.price)) {
          toast.error(`Variant "${variant.name}": sale price cannot be higher than price`);
          return false;
        }
        if (countVariantMedia(variant) < MIN_VARIANT_IMAGES) {
          toast.error(`Variant "${variant.name || ` #${variants.indexOf(variant) + 1}`}": add at least ${MIN_VARIANT_IMAGES} photo`);
          return false;
        }
        if (countVariantMedia(variant) > MAX_VARIANT_IMAGES) {
          toast.error(`Variant "${variant.name}": maximum ${MAX_VARIANT_IMAGES} photos allowed`);
          return false;
        }
      }
    }

    if (modalTab === "category") {
      if (!formData.header || !formData.category || !formData.subcategory) {
        toast.error("Please select Main Group, Category, and Sub-Category");
        return false;
      }
    }

    return true;
  };

  const goToNextTab = () => {
    if (!validateCurrentTab()) return;
    const index = productTabs.findIndex((tab) => tab.id === modalTab);
    if (index < 0 || index >= productTabs.length - 1) return;
    setModalTab(productTabs[index + 1].id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderContinueButton = (nextLabel) => {
    const index = productTabs.findIndex((tab) => tab.id === modalTab);
    const nextTab = index >= 0 ? productTabs[index + 1] : null;
    const isLast = !nextTab;
    return (
      <div className="pt-4 mt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={isLast ? handleSave : goToNextTab}
          disabled={isLast && isSaving}
          className="w-full h-11 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 active:scale-[0.99] text-white text-sm font-semibold shadow-sm transition-all"
        >
          {isLast
            ? isSaving
              ? "Publishing..."
              : "Save & Publish"
            : `Continue${nextLabel || nextTab.label ? ` to ${nextLabel || nextTab.label}` : ""}`}
        </button>
      </div>
    );
  };

  const sanitizeDigits = (value = "") => String(value).replace(/\D+/g, "");

  const sanitizeLicense = (value = "") =>
    String(value)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9/-]+/g, "");

  const sanitizeBatch = (value = "") =>
    String(value)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9-]+/g, "");

  const [formData, setFormData] = useState(() => ({ ...DEFAULT_PRODUCT_FORM }));

  const [dbCategories, setDbCategories] = useState([]);
  const [isLoadingCats, setIsLoadingCats] = useState(true);

  const selectAddMethod = (method) => {
    setAddMethod(method);
    if (method === "single" || method === "bulk") {
      setSearchParams({ method }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const leaveAddProduct = () => {
    clearSellerProductAddDraft();
    navigate("/seller/products");
  };

  // Restore draft + URL method after auth is known (avoids flashing the picker).
  useEffect(() => {
    if (!sellerId || draftHydratedRef.current) return;
    draftHydratedRef.current = true;

    const methodFromUrl = String(searchParams.get("method") || "").toLowerCase();
    const draft = readSellerProductAddDraft();
    const matched = draftMatchesSeller(draft, sellerId) ? draft : null;

    const nextMethod =
      methodFromUrl === "single" || methodFromUrl === "bulk"
        ? methodFromUrl
        : matched?.addMethod === "single" || matched?.addMethod === "bulk"
          ? matched.addMethod
          : null;

    if (nextMethod) {
      setAddMethod(nextMethod);
      if (methodFromUrl !== nextMethod) {
        setSearchParams({ method: nextMethod }, { replace: true });
      }
    }

    if (matched) {
      if (matched.modalTab && matched.modalTab !== "pricing") {
        setModalTab(matched.modalTab === "media" ? "variants" : matched.modalTab);
      } else       if (matched.modalTab === "pricing") setModalTab("variants");
      if (matched.clientRequestId) {
        setClientRequestId(String(matched.clientRequestId));
      }
      if (matched.submitStatus === "publishing") {
        setSubmitStatus("publishing");
        toast.info("Last publish was still processing. Saving again will not create a duplicate.");
      }
      if (matched.formData && typeof matched.formData === "object") {
        const hydrated = hydrateProductFormFromDraft(matched.formData);
        const restoredVariants = Array.isArray(hydrated.variants) && hydrated.variants.length
          ? hydrated.variants
          : [{ id: Date.now(), name: "", price: "", salePrice: "", stock: "", sku: "", media: [] }];
        setFormData((prev) => ({
          ...prev,
          ...hydrated,

          variants: restoredVariants,
        }));
      }
    }

    setDraftReady(true);
  }, [sellerId]);

  useEffect(() => {
    if (!draftReady) return;
    setClientRequestId((prev) => prev || newProductPublishId());
  }, [draftReady]);

  // Persist while editing so refresh keeps single/bulk + filled fields + tab.
  useEffect(() => {
    if (!sellerId || !draftReady) return;
    const timer = window.setTimeout(() => {
      const pendingBlobPreview = (formData.variants || []).some((variant) =>
        (variant.media || []).some((item) => String(item?.preview || "").startsWith("blob:")),
      );
      // Wait until blob previews become data URLs so refresh can restore them.
      if (pendingBlobPreview) return;
      writeSellerProductAddDraft({
        sellerId,
        addMethod,
        modalTab,
        clientRequestId,
        submitStatus,
        formData: serializeProductFormForDraft(formData),
        updatedAt: Date.now(),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    sellerId,
    draftReady,
    addMethod,
    modalTab,
    clientRequestId,
    submitStatus,
    formData,
  ]);

  React.useEffect(() => {
    const fetchCats = async () => {
      try {
        const res = await sellerApi.getCategoryTree();
        if (res.data.success) {
          setDbCategories(res.data.results || res.data.result || []);
        }
      } catch (error) {
        toast.error("Failed to load categories");
      } finally {
        setIsLoadingCats(false);
      }
    };
    fetchCats();
  }, []);

  const categories = dbCategories;

  const getCategoryNodeId = (node) => String(node?._id || node?.id || "");

  // Keep all three levels in sync. Selects have no empty placeholder, so when a
  // parent change clears child IDs the browser still shows the first option —
  // re-fill empty/invalid IDs so UI and form state stay aligned.
  React.useEffect(() => {
    if (isLoadingCats) return;
    if (!Array.isArray(categories) || categories.length === 0) return;

    setFormData((prev) => {
      const currentHeaderId = String(prev.header || "");
      const headerObj =
        categories.find((h) => getCategoryNodeId(h) === currentHeaderId) || categories[0];

      const nextHeaderId = getCategoryNodeId(headerObj);
      const children = headerObj?.children || [];

      const currentCategoryId = String(prev.category || "");
      const categoryObj =
        children.find((c) => getCategoryNodeId(c) === currentCategoryId) || children[0];

      const nextCategoryId = getCategoryNodeId(categoryObj);
      const subList = categoryObj?.children || [];

      const currentSubId = String(prev.subcategory || "");
      const subObj =
        subList.find((sc) => getCategoryNodeId(sc) === currentSubId) || subList[0];

      const nextSubId = getCategoryNodeId(subObj);

      const shouldUpdateHeader = !currentHeaderId || getCategoryNodeId(headerObj) !== currentHeaderId;
      const shouldUpdateCategory = !currentCategoryId || getCategoryNodeId(categoryObj) !== currentCategoryId;
      const shouldUpdateSub = !currentSubId || getCategoryNodeId(subObj) !== currentSubId;

      if (!shouldUpdateHeader && !shouldUpdateCategory && !shouldUpdateSub) return prev;

      return {
        ...prev,
        header: shouldUpdateHeader ? nextHeaderId : prev.header,
        category: shouldUpdateCategory ? nextCategoryId : prev.category,
        subcategory: shouldUpdateSub ? nextSubId : prev.subcategory,
      };
    });
  }, [categories, isLoadingCats, formData.header, formData.category, formData.subcategory]);

  const handleSave = async () => {
    if (isSaving || saveLockRef.current) return;

    // Validate required fields
    if (!formData.name) {
      toast.error("Please fill in the Product Title");
      return;
    }

    // Validate all three category levels are selected
    if (!formData.header || !formData.category || !formData.subcategory) {
      toast.error("Please select all three category levels: Main Group, Specific Category, and Sub-Category");
      return;
    }


    const variants = Array.isArray(formData.variants) ? formData.variants : [];
    if (!variants.length) {
      toast.error("Add at least one variant with price and stock");
      setModalTab("variants");
      return;
    }

    for (const variant of variants) {
      if (!String(variant.name || "").trim()) {
        toast.error("Each variant needs a name (e.g. 1kg, 500ml)");
        setModalTab("variants");
        return;
      }
      if (!variant.price || Number(variant.price) < 1) {
        toast.error(`Variant "${variant.name}": price must be at least ₹1`);
        setModalTab("variants");
        return;
      }
      if (variant.stock === "" || variant.stock == null || Number(variant.stock) < 0) {
        toast.error(`Variant "${variant.name}": stock is required`);
        setModalTab("variants");
        return;
      }
      if (variant.salePrice && Number(variant.salePrice) > 0 && Number(variant.salePrice) > Number(variant.price)) {
        toast.error(`Variant "${variant.name}": sale price cannot be higher than price`);
        setModalTab("variants");
        return;
      }
      if (countVariantMedia(variant) < MIN_VARIANT_IMAGES) {
        toast.error(`Variant "${variant.name || `#${variants.indexOf(variant) + 1}`}": add at least ${MIN_VARIANT_IMAGES} photo`);
        setModalTab("variants");
        return;
      }
      if (countVariantMedia(variant) > MAX_VARIANT_IMAGES) {
        toast.error(`Variant "${variant.name}": maximum ${MAX_VARIANT_IMAGES} photos allowed`);
        setModalTab("variants");
        return;
      }
    }

    if (variants.length > MAX_PRODUCT_VARIANTS) {
      toast.error(`Maximum ${MAX_PRODUCT_VARIANTS} variants allowed`);
      setModalTab("variants");
      return;
    }

    const firstVariant = variants[0] || {};
    const publishId = clientRequestId || newProductPublishId();
    if (!clientRequestId) setClientRequestId(publishId);

    saveLockRef.current = true;
    setIsSaving(true);
    setSubmitStatus("publishing");
    writeSellerProductAddDraft({
      sellerId,
      addMethod,
      modalTab,
      clientRequestId: publishId,
      submitStatus: "publishing",
      formData: serializeProductFormForDraft(formData),
      updatedAt: Date.now(),
    });
    try {
      const data = new FormData();

      // Basic fields
      data.append("name", formData.name);
      data.append("slug", formData.slug);
      data.append("sku", formData.sku);
      data.append("description", formData.description);
      data.append("brand", formData.brand);
      data.append("weight", formData.weight);
      data.append("status", formData.status);

      // Parent price/stock derived from variants (backend also re-derives).
      data.append("price", firstVariant.price || 0);
      data.append("salePrice", firstVariant.salePrice || 0);
      data.append("packingFee", formData.packingFee || 0);
      data.append(
        "stock",
        variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0),
      );
      data.append("lowStockAlert", formData.lowStockAlert || 5);

      // Category IDs
      data.append("headerId", formData.header);
      data.append("categoryId", formData.category);
      data.append("subcategoryId", formData.subcategory);

      // Tags
      data.append("tags", formData.tags);

      // Variants + per-variant images
      data.append("variants", JSON.stringify(serializeVariantsForApi(formData.variants)));
      appendVariantImageFiles(data, formData.variants);
      data.append("clientRequestId", publishId);

      await sellerApi.createProduct(data);
      toast.success("Product saved successfully!");
      clearSellerProductAddDraft();
      saveLockRef.current = false;
      setSubmitStatus("idle");
      navigate("/seller/products");
    } catch (error) {
      saveLockRef.current = false;
      setSubmitStatus("idle");
      toast.error(error.response?.data?.message || "Failed to save product");
    } finally {
      setIsSaving(false);
    }
  };

  const [excelFile, setExcelFile] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const downloadTemplate = async () => {
    try {
      setDownloadingTemplate(true);
      const response = await sellerApi.getProductBulkTemplate();
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "product-bulk-upload-template.xlsx");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      let message = "Failed to download template";
      try {
        const raw = error?.response?.data instanceof Blob
          ? JSON.parse(await error.response.data.text())
          : error?.response?.data;
        message = raw?.message || message;
      } catch {
        // response wasn't JSON — keep the generic message
      }
      toast.error(message);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleBulkUpload = async (e) => {
    e.preventDefault();
    if (!excelFile) {
      toast.error("Please select the filled excel file first");
      return;
    }

    setIsUploading(true);
    setBulkResult(null);

    try {
      const data = new FormData();
      data.append("file", excelFile);
      imageFiles.forEach((file) => data.append("images", file));

      const res = await sellerApi.bulkUploadProductsExcel(data);
      const result = res?.data?.data || {};
      setBulkResult(result);
      if ((result.created || []).length > 0) {
        toast.success(`${result.created.length} product(s) created`);
        clearSellerProductAddDraft();
      }
      if ((result.failed || []).length > 0) {
        toast.error(`${result.failed.length} row(s) failed — see details below`);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to upload and import products");
    } finally {
      setIsUploading(false);
    }
  };

  if (!sellerId || !draftReady) {
    return (
      <div className="max-w-4xl mx-auto py-20 flex justify-center text-sm font-medium text-slate-400">
        Loading...
      </div>
    );
  }

  if (addMethod === null) {
    return (
      <div className="w-full max-w-4xl md:max-w-none mx-auto space-y-4 pb-20 px-3.5 md:px-4 animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            className="pl-0 hover:bg-transparent hover:text-red-600"
            onClick={leaveAddProduct}>
            <HiOutlineArrowLeft className="mr-2 h-5 w-5" />
            Back to Products
          </Button>
        </div>

        <div className="text-center space-y-0.5 py-1">
          <h2 className="text-lg sm:text-xl font-semibold text-[#1c1c1e] tracking-tight">Add New Product</h2>
          <p className="text-xs text-slate-500 font-normal">
            Choose how you want to add products to your store.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {/* Card 1: Single Add */}
          <div
            onClick={() => selectAddMethod("single")}
            className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-all cursor-pointer group flex flex-col items-center text-center space-y-2"
          >
            <div className="h-9 w-9 rounded-lg bg-red-50 border border-red-200/60 text-red-600 flex items-center justify-center shrink-0 shadow-2xs group-hover:bg-red-600 group-hover:text-white transition-colors">
              <HiOutlineCube className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-[#1c1c1e]">Single Product</h3>
            <p className="text-xs text-slate-500 font-normal leading-relaxed">
              Add a single product manually with custom photos, descriptions, and variant configurations.
            </p>
            <span className="text-[11px] font-semibold text-red-600 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1 pt-1">
              PROCEED <HiOutlineArrowLeft className="h-3 w-3 rotate-180" />
            </span>
          </div>

          {/* Card 2: Bulk Upload */}
          <div
            onClick={() => selectAddMethod("bulk")}
            className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-all cursor-pointer group flex flex-col items-center text-center space-y-2"
          >
            <div className="h-9 w-9 rounded-lg bg-red-50 border border-red-200/60 text-red-600 flex items-center justify-center shrink-0 shadow-2xs group-hover:bg-red-600 group-hover:text-white transition-colors">
              <HiOutlineSquaresPlus className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-[#1c1c1e]">Bulk Excel Upload</h3>
            <p className="text-xs text-slate-500 font-normal leading-relaxed">
              Upload an excel plus an images folder. Ideal for importing dozens or hundreds of items at once.
            </p>
            <span className="text-[11px] font-semibold text-red-600 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1 pt-1">
              PROCEED <HiOutlineArrowLeft className="h-3 w-3 rotate-180" />
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (addMethod === "bulk") {
    return (
      <div className="w-full max-w-4xl md:max-w-none mx-auto space-y-4 pb-20 px-3.5 md:px-4 animate-in fade-in duration-300">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
          <button
            onClick={() => selectAddMethod(null)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer">
            <HiOutlineArrowLeft className="h-3.5 w-3.5" />
            <span>Change Method</span>
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-2xs border border-slate-200/80 p-3.5 sm:p-5 space-y-4">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-[#1c1c1e] tracking-tight">Bulk Product Upload</h3>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              Fill an excel with your products (variants included) and upload it together with a folder of images.
            </p>
          </div>

          <form onSubmit={handleBulkUpload} className="space-y-4">
            <ol className="text-xs text-slate-600 list-decimal list-inside space-y-1 bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/60">
              <li>Download the excel template below and fill one row per product.</li>
              <li>Put every image referenced in the Images / Variant Images columns into one folder.</li>
              <li>Upload the filled excel and select that whole folder below.</li>
            </ol>

            <button
              type="button"
              onClick={downloadTemplate}
              disabled={downloadingTemplate}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {downloadingTemplate ? (
                <HiOutlineArrowPath className="h-4 w-4 animate-spin" />
              ) : (
                <HiOutlineSquaresPlus className="h-4 w-4" />
              )}
              Download Excel Template
            </button>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Excel File (.xlsx)</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
                className="text-xs w-full"
                disabled={isUploading}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
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
              <p className="text-[10px] text-slate-400 font-normal mt-1">
                Pick the whole folder that has every image the excel refers to — all images inside are picked up automatically.
              </p>
            </div>

            {bulkResult && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                <div className="px-3 py-2 flex items-center justify-between bg-slate-50">
                  <span className="font-medium text-slate-700">
                    {bulkResult.created?.length || 0} of {bulkResult.totalRows || 0} created
                  </span>
                </div>
                {(bulkResult.created || []).map((row) => (
                  <div key={row.id} className="px-3 py-2 text-green-700">
                    Row {row.row}: {row.name}
                  </div>
                ))}
                {(bulkResult.failed || []).map((row, i) => (
                  <div key={i} className="px-3 py-2 text-red-700">
                    Row {row.row}{row.name ? `: ${row.name}` : ""} — {row.reason}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => selectAddMethod(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!excelFile || isUploading}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer"
              >
                {isUploading ? "Importing..." : "Upload & Import"}
              </button>
            </div>

            {/* Uploading loading overlay modal */}
            {isUploading && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl border border-slate-100 scale-in duration-200">
                  <div className="flex justify-center">
                    <div className="relative flex items-center justify-center animate-bounce">
                      <div className="w-16 h-16 border-4 border-red-500/20 border-t-orange-500 rounded-full animate-spin"></div>
                      <HiOutlineArrowPath className="absolute h-6 w-6 text-red-500 animate-spin" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-black text-slate-800">Uploading & Processing</h3>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed">
                      Please wait while we validate your excel data, process categories, upload images, and create your products in bulk.
                    </p>
                  </div>
                  <div className="bg-red-50/50 rounded-xl py-2 px-4 inline-flex items-center gap-2 text-xs font-bold text-red-600">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    Do not close this page
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl md:max-w-none mx-auto space-y-3 sm:space-y-4 pb-28 md:pb-20 px-3.5 md:px-4 min-w-0 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 pb-1">
        <Button
          variant="ghost"
          className="pl-0 text-xs sm:text-sm font-medium hover:bg-transparent hover:text-red-600 justify-start h-8 min-h-0"
          onClick={leaveAddProduct}>
          <HiOutlineArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Products
        </Button>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" className="text-xs h-9 min-h-0 px-3.5 py-1.5 rounded-lg font-medium" onClick={leaveAddProduct}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-xs overflow-hidden flex flex-col md:flex-row border border-slate-200/80 min-w-0 max-w-full">
        {/* Sidebar Tabs */}
        <div className="md:w-56 bg-slate-50/70 border-b md:border-b-0 md:border-r border-slate-200/80 p-1.5 sm:p-3 flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto gap-1 shrink-0 no-scrollbar">
          {[
            { id: "general", label: "General Info", icon: HiOutlineTag },
            { id: "variants", label: "Item Variants", icon: HiOutlineSwatch },
            { id: "category", label: "Groups", icon: HiOutlineFolderOpen },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setModalTab(tab.id)}
              className={cn(
                "flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left whitespace-nowrap shrink-0 md:w-full min-h-0",
                modalTab === tab.id
                  ? "bg-white text-red-600 shadow-xs border border-slate-200/80 font-semibold"
                  : "text-slate-600 hover:bg-slate-100/70",
              )}>
              <tab.icon className={cn("h-4 w-4 shrink-0", modalTab === tab.id ? "text-red-600" : "text-slate-400")} />
              <span>{tab.label}</span>
            </button>
          ))}

          <div className="hidden md:block pt-6 px-3">
            <div className="p-3 bg-emerald-50/80 rounded-lg border border-emerald-200/70">
              <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1">
                Status
              </p>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value })
                }
                className="w-full bg-transparent border-none text-xs font-semibold text-emerald-800 outline-none p-0 cursor-pointer focus:ring-0">
                <option value="active">PUBLISHED</option>
                <option value="inactive">DRAFT</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-3.5 sm:p-5 lg:p-6 overflow-y-auto">
          {modalTab === "general" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
              <div className="space-y-1 flex flex-col">
                <label className="text-xs font-medium text-slate-700">
                  Product Title
                </label>
                <input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20 transition-all placeholder:text-slate-400"
                  placeholder="e.g. Premium Basmati Rice"
                />
              </div>
              <div className="space-y-1 flex flex-col">
                <label className="text-xs font-medium text-slate-700">
                  About this item
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  onWheel={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal text-slate-900 min-h-[120px] max-h-[220px] outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20 resize-none overflow-y-auto custom-scrollbar placeholder:text-slate-400"
                  placeholder="Describe the item here..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-1 flex flex-col">
                  <label className="text-xs font-medium text-slate-700">
                    Brand Name
                  </label>
                  <input
                    value={formData.brand}
                    onChange={(e) =>
                      setFormData({ ...formData, brand: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20 transition-all placeholder:text-slate-400"
                    placeholder="e.g. Amul"
                  />
                </div>
                <div className="space-y-1 flex flex-col">
                  <label className="text-xs font-medium text-slate-700">
                    Product Code
                  </label>
                  <input
                    value={formData.sku}
                    readOnly
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-medium outline-none text-slate-400 cursor-not-allowed"
                    placeholder="AUTO-GENERATED"
                  />
                </div>
              </div>
              {renderContinueButton()}
            </div>
          )}


          {modalTab === "variants" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
              <div className="p-3.5 sm:p-4 bg-slate-50/70 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-1 flex flex-col">
                  <label className="text-xs font-medium text-slate-700">
                    Packing Fee (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.packingFee}
                    onChange={(e) => setFormData({ ...formData, packingFee: e.target.value })}
                    placeholder="e.g. 10"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm sm:text-base font-semibold outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20"
                  />
                  <p className="text-[10px] text-slate-500 font-medium ml-1">
                    One packing fee for the whole product (applies to all variants).
                  </p>
                </div>
                <div className="space-y-1 flex flex-col">
                  <label className="text-xs font-medium text-rose-600">
                    Alert me when stock is below
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.lowStockAlert}
                    onChange={(e) => setFormData({ ...formData, lowStockAlert: e.target.value })}
                    className="w-full px-3 py-2 bg-rose-50/40 border border-rose-200 rounded-lg text-xs sm:text-sm font-medium text-rose-700 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400/20"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-slate-900">
                    Product Variants
                  </h4>
                  <p className="text-xs text-slate-600 font-medium">
                    Price and stock live on each variant. Max {MAX_PRODUCT_VARIANTS} variants, {MIN_VARIANT_IMAGES}–{MAX_VARIANT_IMAGES} photos each.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if ((formData.variants || []).length >= MAX_PRODUCT_VARIANTS) {
                      toast.error(`Maximum ${MAX_PRODUCT_VARIANTS} variants allowed`);
                      return;
                    }
                    setFormData({
                      ...formData,
                      variants: [
                        ...(formData.variants || []),
                        {
                          id: Date.now(),
                          name: "",
                          price: "",
                          salePrice: "",
                          stock: "",
                          sku: "",
                          media: [],
                        },
                      ],
                    });
                  }}
                  disabled={(formData.variants || []).length >= MAX_PRODUCT_VARIANTS}
                  className="inline-flex items-center justify-center gap-2 shrink-0 self-start sm:self-auto px-3.5 py-2 bg-red-500/10 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wide hover:bg-red-500/20 transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                  <HiOutlineSquaresPlus className="h-4 w-4 shrink-0" />
                  <span>Add Variant</span>
                </button>
              </div>

              {(<div className="space-y-3">
                  {(formData.variants || []).map((variant, index) => (
                    <div
                      key={variant.id}
                      className="p-4 bg-slate-50 rounded-2xl border border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-4 items-end group relative">
                      <div className="col-span-12 md:col-span-3 space-y-1">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                          Variant Name
                        </label>
                        <input
                          value={variant.name}
                          onChange={(e) => {
                            const newVariants = [...formData.variants];
                            newVariants[index].name = e.target.value;
                            setFormData({ ...formData, variants: newVariants });
                          }}
                          placeholder="e.g. 1kg Bag"
                          className="w-full px-3 py-2 bg-white ring-1 ring-slate-200 border-none rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-red-500/10"
                        />
                      </div>
                      <div className="col-span-6 md:col-span-2 space-y-1">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                          Price
                        </label>
                        <input
                          type="number"
                          value={variant.price}
                          onChange={(e) => {
                            const newVariants = [...formData.variants];
                            newVariants[index].price = e.target.value;
                            setFormData({ ...formData, variants: newVariants });
                          }}
                          placeholder="500"
                          className="w-full px-3 py-2 bg-white ring-1 ring-slate-200 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-red-500/10"
                        />
                      </div>
                      <div className="col-span-6 md:col-span-2 space-y-1">
                        <label className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest ml-1">
                          Sale
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={variant.salePrice}
                          onChange={(e) => {
                            const newVariants = [...formData.variants];
                            newVariants[index].salePrice = e.target.value;
                            setFormData({ ...formData, variants: newVariants });
                          }}
                          placeholder="450"
                          className={`w-full px-3 py-2 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 ${variant.salePrice && Number(variant.salePrice) < 1 ? "bg-red-50 ring-1 ring-red-300 text-red-600 focus:ring-red-300" : "bg-emerald-50 ring-1 ring-emerald-100 text-emerald-700 focus:ring-emerald-200"}`}
                        />
                        {variant.salePrice && Number(variant.salePrice) < 1 && (
                          <p className="text-[9px] font-semibold text-red-500 ml-1">Min value is 1</p>
                        )}
                      </div>
                      <div className="col-span-6 md:col-span-2 space-y-1">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                          Stock
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={variant.stock}
                          onChange={(e) => {
                            const newVariants = [...formData.variants];
                            newVariants[index].stock = e.target.value;
                            setFormData({ ...formData, variants: newVariants });
                          }}
                          placeholder="10"
                          className={`w-full px-3 py-2 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 ${variant.stock && Number(variant.stock) < 1 ? "bg-red-50 ring-1 ring-red-300 text-red-600 focus:ring-red-300" : "bg-white ring-1 ring-slate-200 focus:ring-red-500/10"}`}
                        />
                        {variant.stock && Number(variant.stock) < 1 && (
                          <p className="text-[9px] font-semibold text-red-500 ml-1">Min value is 1</p>
                        )}
                      </div>
                      <div className="col-span-5 md:col-span-2 space-y-1">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                          Product Code
                        </label>
                        <input
                          value={variant.sku}
                          readOnly
                          placeholder="AUTO-GENERATED"
                          className="w-full px-3 py-2 bg-slate-100 ring-1 ring-slate-200 border-none rounded-xl text-xs font-mono font-bold text-slate-400 cursor-not-allowed outline-none"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end pb-1">
                        <button
                          type="button"
                          onClick={() => {
                            if ((formData.variants || []).length <= 1) {
                              toast.error("At least one variant is required");
                              return;
                            }
                            const newVariants = formData.variants.filter((_, i) => i !== index);
                            setFormData({ ...formData, variants: newVariants });
                          }}
                          className="p-2 text-slate-300 hover:text-rose-500 transition-colors">
                          <HiOutlineTrash className="h-4 w-4" />
                        </button>
                      </div>
                      <VariantImageSlots
                        variant={variant}
                        compact
                        onChange={(nextVariant) => {
                          setFormData((prev) => {
                            const variants = [...(prev.variants || [])];
                            const matchedIndex = variants.findIndex(
                              (item) => String(item.id) === String(nextVariant.id),
                            );
                            const at = matchedIndex >= 0 ? matchedIndex : index;
                            if (!variants[at]) return prev;
                            variants[at] = { ...variants[at], media: nextVariant.media };
                            return { ...prev, variants };
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>)}
              {renderContinueButton()}
            </div>
          )}

          {modalTab === "category" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300 min-w-0 max-w-full overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 min-w-0 max-w-full">
                <div className="space-y-1 flex flex-col min-w-0 max-w-full">
                  <label className="text-xs font-medium text-slate-700">
                    Main Group <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.header}
                    onChange={(e) => {
                      const nextHeaderId = e.target.value;
                      const headerObj = categories.find(
                        (h) => getCategoryNodeId(h) === String(nextHeaderId),
                      );
                      const firstCategory = headerObj?.children?.[0];
                      const nextCategoryId = getCategoryNodeId(firstCategory);
                      const firstSub = firstCategory?.children?.[0];
                      setFormData({
                        ...formData,
                        header: nextHeaderId,
                        category: nextCategoryId,
                        subcategory: getCategoryNodeId(firstSub),
                      });
                    }}
                    className="w-full max-w-full truncate px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-900 outline-none cursor-pointer focus:border-red-500 focus:ring-1 focus:ring-red-500/20 transition-all">
                    {categories.map((h) => (
                      <option key={h._id || h.id} value={h._id || h.id} className="truncate">
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 flex flex-col min-w-0 max-w-full">
                  <label className="text-xs font-medium text-slate-700">
                    Specific Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => {
                      const nextCategoryId = e.target.value;
                      const headerObj = categories.find(
                        (h) => getCategoryNodeId(h) === String(formData.header || ""),
                      );
                      const categoryObj = headerObj?.children?.find(
                        (c) => getCategoryNodeId(c) === String(nextCategoryId),
                      );
                      const firstSub = categoryObj?.children?.[0];
                      setFormData({
                        ...formData,
                        category: nextCategoryId,
                        subcategory: getCategoryNodeId(firstSub),
                      });
                    }}
                    disabled={!formData.header}
                    className="w-full max-w-full truncate px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-900 outline-none cursor-pointer focus:border-red-500 focus:ring-1 focus:ring-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    {categories
                      .find((h) => getCategoryNodeId(h) === String(formData.header || ""))
                      ?.children?.map((c) => (
                        <option key={c._id || c.id} value={c._id || c.id} className="truncate">
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:gap-4 min-w-0 max-w-full">
                <div className="space-y-1 flex flex-col min-w-0 max-w-full">
                  <label className="text-xs font-medium text-slate-700">
                    Sub-Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.subcategory}
                    onChange={(e) =>
                      setFormData({ ...formData, subcategory: e.target.value })
                    }
                    disabled={!formData.category}
                    className="w-full max-w-full truncate px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-900 outline-none cursor-pointer focus:border-red-500 focus:ring-1 focus:ring-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    {categories
                      .find((h) => getCategoryNodeId(h) === String(formData.header || ""))
                      ?.children?.find((c) => getCategoryNodeId(c) === String(formData.category || ""))
                      ?.children?.map((sc) => (
                        <option key={sc._id || sc.id} value={sc._id || sc.id} className="truncate">
                          {sc.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {renderContinueButton()}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AddProduct;
