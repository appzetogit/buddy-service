import ExcelJS from 'exceljs';
import { QuickCategory } from '../../models/category.model.js';
import { createSellerProductController } from '../controllers/seller.controller.js';
// Generic Excel-row / image-filename helpers already built for the food module — reused as-is.
import { parseWorkbookRows, buildImageMap } from '../../../food/shared/bulkImport.service.js';

export { parseWorkbookRows, buildImageMap };

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '');

const makeError = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactCi = (value) => ({ $regex: `^${escapeRegex(value)}$`, $options: 'i' });
const SELECTABLE = { isActive: { $ne: false }, status: { $ne: 'inactive' } };

export async function resolveCategoryPathByName({ headerName, categoryName, subcategoryName }) {
    if (!String(headerName || '').trim()) throw makeError('Header Category is required');

    const headers = await QuickCategory.find({ type: 'header', name: exactCi(headerName), ...SELECTABLE }).lean();
    const header = headers[0];
    if (!header) throw makeError(`Header category "${headerName}" not found`);

    let category = null;
    if (String(categoryName || '').trim()) {
        category = await QuickCategory.findOne({ type: 'category', parentId: header._id, name: exactCi(categoryName), ...SELECTABLE }).lean();
        if (!category) throw makeError(`Category "${categoryName}" not found under "${headerName}"`);
    }

    let subcategory = null;
    if (category && String(subcategoryName || '').trim()) {
        subcategory = await QuickCategory.findOne({ type: 'subcategory', parentId: category._id, name: exactCi(subcategoryName), ...SELECTABLE }).lean();
        if (!subcategory) throw makeError(`Subcategory "${subcategoryName}" not found under "${categoryName}"`);
    }

    return {
        headerId: String(header._id),
        categoryId: category ? String(category._id) : undefined,
        subcategoryId: subcategory ? String(subcategory._id) : undefined
    };
}

// "Small:100:90:20;Large:150:140:10" -> [{name, price, salePrice, stock}]. SalePrice may be blank.
export function parseSellerVariantsCell(value) {
    if (!value) return [];
    return String(value)
        .split(';')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
            const [name, price, salePrice, stock] = chunk.split(':').map((part) => (part ?? '').trim());
            return {
                name,
                price: Number(price),
                salePrice: salePrice ? Number(salePrice) : 0,
                stock: stock ? Number(stock) : 0
            };
        })
        .filter((v) => v.name && Number.isFinite(v.price) && v.price > 0);
}

// "s1.jpg,s2.jpg|l1.jpg" -> [["s1.jpg","s2.jpg"], ["l1.jpg"]], one group per variant in order.
export function parseVariantImageGroups(value) {
    if (!value) return [];
    return String(value)
        .split('|')
        .map((group) => group.split(',').map((f) => f.trim()).filter(Boolean));
}

async function buildRowPayload(row, imagesMap) {
    const name = row.productname || row.name || '';
    if (!name) throw makeError('Product Name is required');

    let variantSpecs = parseSellerVariantsCell(row.variants);
    let variantImageGroups = parseVariantImageGroups(row.variantimages);

    if (variantSpecs.length === 0) {
        const price = Number(row.price);
        if (!Number.isFinite(price) || price <= 0) {
            throw makeError('Price is required when no Variants are given');
        }
        variantSpecs = [{
            name: row.variantlabel || 'Default',
            price,
            salePrice: row.saleprice ? Number(row.saleprice) : 0,
            stock: row.stock ? Number(row.stock) : 0
        }];
        variantImageGroups = [String(row.images || '').split(',').map((f) => f.trim()).filter(Boolean)];
    }

    if (variantSpecs.length > 5) throw makeError('Maximum 5 variants allowed per product');

    const files = {};
    variantSpecs.forEach((variant, index) => {
        const filenames = variantImageGroups[index] || [];
        const matched = filenames.map((fn) => imagesMap.get(norm(fn))).filter(Boolean);
        if (matched.length === 0) {
            throw makeError(`Variant "${variant.name}": no matching image found (checked: ${filenames.join(', ') || 'none listed'})`);
        }
        files[`variantImages_${index}`] = matched;
    });

    const categoryIds = await resolveCategoryPathByName({
        headerName: row.headercategory || row.header,
        categoryName: row.category,
        subcategoryName: row.subcategory,
    });

    const body = {
        name,
        description: row.description || '',
        brand: row.brand || '',
        tags: row.tags || '',
        variants: JSON.stringify(variantSpecs.map((v) => ({ name: v.name, price: v.price, salePrice: v.salePrice, stock: v.stock }))),
        headerId: categoryIds.headerId,
        categoryId: categoryIds.categoryId,
        subcategoryId: categoryIds.subcategoryId,
        status: 'active'
    };


    return { body, files };
}

async function createOneSellerProduct(sellerId, body, files) {
    const req = { body, files, user: { userId: sellerId } };
    let statusCode = 200;
    let payload = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { payload = data; return this; }
    };
    await createSellerProductController(req, res);
    if (statusCode >= 400 || payload?.success === false) {
        throw new Error(payload?.message || 'Failed to create product');
    }
    return payload.result;
}

export async function bulkCreateSellerProducts({ rows, imagesMap, sellerId }) {
    const created = [];
    const failed = [];

    for (const row of rows) {
        const name = row.productname || row.name || '';
        try {
            const { body, files } = await buildRowPayload(row, imagesMap);
            const result = await createOneSellerProduct(sellerId, body, files);
            created.push({ row: row.rowNumber, id: String(result._id || result.id), name: result.name || name });
        } catch (err) {
            failed.push({ row: row.rowNumber, name, reason: err?.message || 'Failed to create this product' });
        }
    }

    return { created, failed, totalRows: rows.length };
}

export async function generateSellerTemplateBuffer() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');

    const baseHeaders = [
        'Product Name', 'Description', 'Brand', 'Header Category', 'Category', 'Subcategory', 'Tags',
        'Price', 'Sale Price', 'Stock', 'Variant Label', 'Images',
        'Variants', 'Variant Images'
    ];
    const headers = baseHeaders;

    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    headers.forEach((_, i) => { sheet.getColumn(i + 1).width = 22; });

    const qcExample = [
        'Amul Fresh Milk', 'Pure and fresh toned milk', 'Amul', 'Grocery', 'Dairy & Breakfast', 'Milk',
        'dairy,fresh', '', '', '', '', '',
        'Small:28:25:100;Large:55:50:60', 'small1.jpg,small2.jpg|large1.jpg'
    ];
    sheet.addRow(qcExample);

    const notes = workbook.addWorksheet('Instructions');
    notes.addRow(['1. Fill one row per product on the first sheet.']);
    notes.addRow(['2. Either fill Variants (for multiple sizes/packs) OR just Price/Stock/Images for a single-variant product.']);
    notes.addRow(['3. Variants format: Name:Price:SalePrice:Stock separated by semicolons, e.g. Small:100:90:20;Large:150:140:10. Leave SalePrice blank if none, e.g. Small:100::20.']);
    notes.addRow(['4. Variant Images: one group per variant separated by |, filenames within a group separated by commas, in the same order as Variants, e.g. small1.jpg,small2.jpg|large1.jpg. Each variant needs at least 1 image, max 3.']);
    notes.addRow(['5. Header Category / Category / Subcategory must exactly match existing category names in your store.']);
    notes.getColumn(1).width = 110;

    return workbook.xlsx.writeBuffer();
}
