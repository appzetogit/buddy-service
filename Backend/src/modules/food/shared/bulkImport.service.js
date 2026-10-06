import ExcelJS from 'exceljs';
import { ValidationError } from '../../../core/auth/errors.js';
import { FoodRestaurant } from '../restaurant/models/restaurant.model.js';
import { uploadImageBuffer } from '../../../services/cloudinary.service.js';

// Bulk Excel import for Foods and Addons, shared by both the admin panel and
// the restaurant dashboard so every caller reuses the exact same per-item
// create functions (createFood/createRestaurantFood, createRestaurantAddon/
// createRestaurantAddonAdmin) instead of re-validating anything itself.

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '');

const cellText = (cell) => {
    let value = cell.value;
    if (value && typeof value === 'object') {
        if ('text' in value) value = value.text; // rich text
        else if ('result' in value) value = value.result; // formula
        else if ('hyperlink' in value) value = value.text || value.hyperlink;
    }
    return value == null ? '' : String(value).trim();
};

export async function parseWorkbookRows(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ValidationError('The excel file has no sheet');

    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        headers[colNumber] = norm(cellText(cell));
    });

    const rows = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        if (row.cellCount === 0) continue;
        const obj = { rowNumber: r };
        let hasValue = false;
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const key = headers[colNumber];
            if (!key) return;
            const value = cellText(cell);
            if (value) hasValue = true;
            obj[key] = value;
        });
        if (hasValue) rows.push(obj);
    }
    return rows;
}

export function buildImageMap(files = []) {
    const map = new Map();
    for (const file of files) {
        if (file?.originalname) map.set(norm(file.originalname), file);
    }
    return map;
}

// "Small:149:piece;Medium:199:piece" -> [{name, price, unit}]
export function parseVariantsCell(value) {
    if (!value) return [];
    return String(value)
        .split(';')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
            const [name, price, unit] = chunk.split(':').map((part) => (part || '').trim());
            return { name, price: Number(price), unit: unit || 'piece' };
        })
        .filter((v) => v.name && Number.isFinite(v.price) && v.price > 0);
}

async function resolveRestaurantIdByName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new ValidationError('Restaurant Name is required');
    const exact = `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    const matches = await FoodRestaurant.find({ restaurantName: { $regex: exact, $options: 'i' } })
        .select('_id')
        .limit(2)
        .lean();
    if (matches.length === 0) throw new ValidationError(`Restaurant "${trimmed}" not found`);
    if (matches.length > 1) throw new ValidationError(`Multiple restaurants match "${trimmed}" — rename one or use a more specific name`);
    return String(matches[0]._id);
}

async function uploadRowImage(row, imagesMap, folder) {
    const filename = row.image;
    if (!filename) return '';
    const file = imagesMap.get(norm(filename));
    if (!file) throw new ValidationError(`Image "${filename}" was not found among the uploaded images`);
    return uploadImageBuffer(file.buffer, folder);
}

export async function bulkCreateFoods({ rows, imagesMap, isAdmin, restaurantId, folder = 'appzeto/bulk/foods' }) {
    const { createFood } = await import('../admin/services/admin.service.js');
    const { createRestaurantFood } = await import('../restaurant/services/restaurantFood.service.js');

    const created = [];
    const failed = [];

    for (const row of rows) {
        const name = row.foodname || row.name || '';
        try {
            if (!name) throw new ValidationError('Food Name is required');
            const image = await uploadRowImage(row, imagesMap, folder);
            const variants = parseVariantsCell(row.variants);
            if (variants.length === 0 && !(Number(row.price) > 0)) {
                throw new ValidationError('Price is required when no Variants are given');
            }

            const body = {
                name,
                description: row.description || '',
                price: row.price ? Number(row.price) : undefined,
                otherPrice: row.otherprice ? Number(row.otherprice) : undefined,
                foodType: /non/i.test(row.foodtype || '') ? 'Non-Veg' : 'Veg',
                categoryName: row.categoryname || '',
                variants,
                image,
                images: image ? [image] : [],
                tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
                isRecommended: /^y/i.test(row.isrecommended || '')
            };

            const doc = isAdmin
                ? await createFood({ ...body, restaurantId: await resolveRestaurantIdByName(row.restaurantname) })
                : await createRestaurantFood(restaurantId, body);

            created.push({ row: row.rowNumber, id: String(doc._id), name });
        } catch (err) {
            failed.push({ row: row.rowNumber, name, reason: err?.message || 'Failed to create this item' });
        }
    }

    return { created, failed, totalRows: rows.length };
}

export async function bulkCreateAddons({ rows, imagesMap, isAdmin, restaurantId, performer = null, folder = 'appzeto/bulk/addons' }) {
    const { createRestaurantAddonAdmin } = await import('../admin/services/admin.service.js');
    const { createRestaurantAddon } = await import('../restaurant/services/restaurantAddon.service.js');

    const created = [];
    const failed = [];

    for (const row of rows) {
        const name = row.addonname || row.name || '';
        try {
            if (!name) throw new ValidationError('Addon Name is required');
            const priceNum = Number(row.price);
            if (!Number.isFinite(priceNum) || priceNum < 0) throw new ValidationError('A valid Price is required');
            const image = await uploadRowImage(row, imagesMap, folder);

            const body = {
                name,
                description: row.description || '',
                price: priceNum,
                foodType: /non/i.test(row.foodtype || '') ? 'Non-Veg' : 'Veg',
                image,
                images: image ? [image] : []
            };

            const doc = isAdmin
                ? await createRestaurantAddonAdmin({ ...body, restaurantId: await resolveRestaurantIdByName(row.restaurantname) }, performer)
                : await createRestaurantAddon(restaurantId, body);

            created.push({ row: row.rowNumber, id: String(doc._id), name });
        } catch (err) {
            failed.push({ row: row.rowNumber, name, reason: err?.message || 'Failed to create this item' });
        }
    }

    return { created, failed, totalRows: rows.length };
}

export async function generateTemplateBuffer({ kind, includeRestaurant }) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(kind === 'food' ? 'Foods' : 'Addons');

    const baseHeaders = kind === 'food'
        ? ['Food Name', 'Description', 'Price', 'Other Price', 'Food Type', 'Variants', 'Category Name', 'Image', 'Tags', 'Is Recommended']
        : ['Addon Name', 'Description', 'Price', 'Food Type', 'Image'];
    const headers = includeRestaurant ? ['Restaurant Name', ...baseHeaders] : baseHeaders;

    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    headers.forEach((_, i) => { sheet.getColumn(i + 1).width = 24; });

    const foodExample = ['Margherita Pizza', 'Classic cheese pizza', 199, 249, 'Veg', 'Small:149:piece;Medium:199:piece;Large:299:piece', 'Pizza', 'margherita.jpg', 'bestseller,cheese', 'Yes'];
    const addonExample = ['Extra Cheese', 'Add more cheese on top', 20, 'Veg', 'extra-cheese.jpg'];
    const example = kind === 'food' ? foodExample : addonExample;
    sheet.addRow(includeRestaurant ? ['Trisha Restaurant', ...example] : example);

    const notes = workbook.addWorksheet('Instructions');
    notes.addRow(['1. Fill one row per item on the first sheet.']);
    notes.addRow(['2. Image column = the exact filename of an image you upload together with this excel (e.g. margherita.jpg).']);
    if (kind === 'food') {
        notes.addRow(['3. Variants (optional) = Name:Price:Unit separated by semicolons, e.g. Small:149:piece;Large:299:piece. Leave blank to use the Price column instead.']);
    }
    if (includeRestaurant) {
        notes.addRow([`${kind === 'food' ? '4' : '3'}. Restaurant Name must exactly match an existing restaurant.`]);
    }
    notes.addRow([`${kind === 'food' ? (includeRestaurant ? '5' : '4') : (includeRestaurant ? '4' : '3')}. Food Type must be "Veg" or "Non-Veg".`]);
    notes.getColumn(1).width = 100;

    return workbook.xlsx.writeBuffer();
}
