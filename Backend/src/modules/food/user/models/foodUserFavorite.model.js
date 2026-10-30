import mongoose from 'mongoose';

const foodUserFavoriteSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            required: true,
            unique: true,
            index: true
        },
        restaurantIds: [{ type: String, trim: true }],
        foodIds: [{ type: String, trim: true }]
    },
    {
        collection: 'food_user_favorites',
        timestamps: true
    }
);

foodUserFavoriteSchema.index({ userId: 1 });

export const FoodUserFavorite = mongoose.model('FoodUserFavorite', foodUserFavoriteSchema);

