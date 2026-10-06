// Variant and cart-line helpers shared by Quick Commerce product, cart, wishlist and checkout screens.

const isDefaultPlaceholderVariant = (variant) => {
  if (!variant || typeof variant !== "object") return false;
  const packQty = variant.packQuantity;
  const hasPackQty =
    packQty !== "" &&
    packQty != null &&
    Number.isFinite(Number(packQty)) &&
    Number(packQty) > 0;

  return (
    String(variant.name || "").trim() === "Default" &&
    !String(variant.strength || "").trim() &&
    !String(variant.packType || "").trim() &&
    !hasPackQty &&
    !String(variant.unit || "").trim()
  );
};

export const variantsWithoutPlaceholder = (variants) =>
  (Array.isArray(variants) ? variants : []).filter(
    (v) => !isDefaultPlaceholderVariant(v),
  );

export const getVariantKey = (variant) => {
  if (!variant || typeof variant !== "object") return "";
  // Prefer stable Mongo id, then sku, then display name
  const id = String(variant._id || variant.id || "").trim();
  if (id) return id;
  const sku = String(variant.sku || "").trim();
  if (sku) return sku;
  const name = String(variant.name || "").trim();
  if (name && name !== "Default") return name;
  return name;
};

export const variantsMatch = (a = {}, b = {}) => {
  const aId = String(a?._id || a?.id || "").trim().toLowerCase();
  const bId = String(b?._id || b?.id || "").trim().toLowerCase();
  if (aId && bId && aId === bId) return true;

  const aKey = getVariantKey(a).toLowerCase();
  const bKey = getVariantKey(b).toLowerCase();
  if (aKey && bKey && aKey === bKey) return true;

  const aName = String(a?.name || "").trim().toLowerCase();
  const bName = String(b?.name || "").trim().toLowerCase();
  if (aName && bName && aName === bName) return true;

  const aSku = String(a?.sku || "").trim().toLowerCase();
  const bSku = String(b?.sku || "").trim().toLowerCase();
  if (aSku && bSku && aSku === bSku) return true;

  return false;
};

export const findCartLineForProduct = (cart = [], product = {}, selectedVariant = null) => {
  const baseId = String(product?.productId || product?.id || product?._id || "")
    .trim()
    .split("::")[0];
  if (!baseId) return null;

  const variant =
    selectedVariant ||
    product?.selectedVariant ||
    null;
  const targetLineId = variant ? getCartLineId(baseId, variant) : baseId;
  const targetName = String(variant?.name || "").trim().toLowerCase();
  const targetKey = getVariantKey(variant).toLowerCase();

  const candidates = (Array.isArray(cart) ? cart : []).filter((item) => {
    const itemBase = String(item?.productId || item?.itemId || item?.id || item?._id || "")
      .trim()
      .split("::")[0];
    return itemBase === baseId;
  });

  if (!candidates.length) return null;

  // Exact composite id match
  const byLineId = candidates.find((item) => {
    const id = String(item?.id || item?._id || "").trim();
    return targetLineId && id === targetLineId;
  });
  if (byLineId) return byLineId;

  if (variant) {
    const byVariant = candidates.find((item) => {
      const itemVariant = item?.selectedVariant || {
        _id: item?.variantKey,
        id: item?.variantKey,
        name: item?.variantName,
        sku: item?.variantSku,
      };
      if (variantsMatch(variant, itemVariant)) return true;
      const itemKey = String(item?.variantKey || getVariantKey(item?.selectedVariant) || "")
        .trim()
        .toLowerCase();
      const itemName = String(item?.variantName || item?.selectedVariant?.name || "")
        .trim()
        .toLowerCase();
      if (targetKey && itemKey && targetKey === itemKey) return true;
      if (targetName && itemName && targetName === itemName) return true;
      return false;
    });
    if (byVariant) return byVariant;

    // Legacy empty-variant line only counts for the product's first sellable variant
    const legacy = candidates.find((item) => {
      const itemKey = String(item?.variantKey || item?.selectedVariant?._id || "").trim();
      const itemName = String(item?.variantName || item?.selectedVariant?.name || "").trim();
      return !itemKey && !itemName;
    });
    if (legacy) {
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      const first =
        variants.find((v) => {
          const name = String(v?.name || "").trim();
          if (!name || name.toLowerCase() === "default") return variants.length === 1;
          return true;
        }) || variants[0] || null;
      if (!first || variantsMatch(variant, first)) return legacy;
    }

    // Specific variant requested but not in cart → ADD (do not fall back to sibling)
    return null;
  }

  // No variant context: prefer bare/legacy line, else first candidate
  const bare = candidates.find((item) => {
    const itemKey = String(item?.variantKey || item?.selectedVariant?._id || "").trim();
    const itemName = String(item?.variantName || item?.selectedVariant?.name || "").trim();
    return !itemKey && !itemName;
  });
  return bare || candidates[0] || null;
};

export const getCartLineId = (productId, variant) => {
  const baseId = String(productId || "").trim().split("::")[0];
  if (!baseId) return "";
  const variantKey = getVariantKey(variant);
  return variantKey ? `${baseId}::${variantKey}` : baseId;
};

export const applyVariantToProduct = (product = {}, variant = null) => {
  if (!variant) return product;

  const baseId = String(product.id || product._id || "").trim().split("::")[0];
  const basePrice = Number(variant.price || 0);
  const rawSale = Number(variant.salePrice || 0);
  const listPrice = Math.max(
    basePrice,
    rawSale,
    Number(variant.originalPrice ?? variant.mrp ?? 0),
    Number(product.originalPrice ?? product.mrp ?? 0),
  );
  const price =
    rawSale > 0 && listPrice > 0 && rawSale < listPrice
      ? rawSale
      : basePrice || rawSale || listPrice;
  const originalPrice = Math.max(listPrice, price);

  return {
    ...product,
    id: getCartLineId(baseId, variant),
    _id: getCartLineId(baseId, variant),
    productId: baseId,
    selectedVariant: variant,
    price,
    salePrice: rawSale,
    mrp: originalPrice,
    originalPrice,
    stock: Number(variant.stock ?? product.stock ?? 0),
    weight: variant.name || product.weight || product.unit || "",
    unit: variant.unit || product.unit || variant.name || "",
    images: Array.isArray(variant.images) && variant.images.length
      ? variant.images.filter(Boolean)
      : product.images,
    image: Array.isArray(variant.images) && variant.images.length
      ? variant.images[0]
      : product.image,
    mainImage: Array.isArray(variant.images) && variant.images.length
      ? variant.images[0]
      : product.mainImage,
  };
};

export const getVariantDisplayLabel = (variant) => {
  if (!variant) return "";
  const named = String(variant.name || "").trim();
  if (named && named !== "Default") return named;
  return String(variant.unit || "").trim() || "Variant";
};

export const getVariantPickerMeta = (variant, product = {}) => {
  if (!variant) {
    return { title: "", subtitle: "", image: "" };
  }

  const title = getVariantDisplayLabel(variant);
  const detailLines = [];

  const sku = String(variant.sku || "").trim();
  if (sku) detailLines.push(`SKU: ${sku}`);

  const unit = String(variant.unit || product.unit || "").trim();
  if (unit && unit !== title && !detailLines.some((line) => line.includes(unit))) {
    detailLines.push(unit);
  }

  const variantImages = Array.isArray(variant.images) ? variant.images.filter(Boolean) : [];
  const image =
    variantImages[0] ||
    product.mainImage ||
    product.image ||
    (Array.isArray(product.galleryImages) ? product.galleryImages[0] : "") ||
    "";

  return {
    title,
    subtitle: detailLines.join(" · "),
    image,
  };
};
