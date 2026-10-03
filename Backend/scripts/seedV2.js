import mongoose from 'mongoose';
import { ServiceTab } from './Backend/src/modules/landingV2/models/serviceTab.model.js';
import { LandingContent } from './Backend/src/modules/landingV2/models/landingContent.model.js';
import dotenv from 'dotenv';

dotenv.config({ path: './Backend/.env' });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/buddy_service';

async function seed() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // Clear existing data
        await ServiceTab.deleteMany({});
        await LandingContent.deleteMany({});

        // 1. Create Tabs
        const tabs = await ServiceTab.create([
            { title: 'Food', serviceKey: 'food', sortOrder: 1 },
            { title: 'Taxi', serviceKey: 'taxi', sortOrder: 2 }
        ]);
        console.log('Tabs seeded');

        // 2. Create Content for Food
        await LandingContent.create([
            {
                serviceType: 'food',
                contentType: 'HERO_BANNER',
                imageUrl: 'https://res.cloudinary.com/dtl7v76p4/image/upload/v1715150000/banner1.jpg',
                title: 'Manchurian Noodles',
                isActive: true
            },
            {
                serviceType: 'food',
                contentType: 'CIRCULAR_ICON',
                title: 'Deal-icious Deals',
                imageUrl: 'https://res.cloudinary.com/dtl7v76p4/image/upload/v1715150001/deal1.jpg',
                offerText: 'FLAT ₹200 OFF',
                sortOrder: 1
            },
            {
                serviceType: 'food',
                contentType: 'CIRCULAR_ICON',
                title: 'Play & Win ₹600',
                imageUrl: 'https://res.cloudinary.com/dtl7v76p4/image/upload/v1715150002/deal2.jpg',
                sortOrder: 2
            },
            {
                serviceType: 'food',
                contentType: 'RECTANGULAR_OFFER',
                title: '40% Off',
                subtitle: 'MIN.',
                imageUrl: 'https://res.cloudinary.com/dtl7v76p4/image/upload/v1715150003/tag.jpg',
                sortOrder: 1
            },
            {
                serviceType: 'food',
                contentType: 'RECTANGULAR_OFFER',
                title: 'Under ₹250',
                subtitle: 'BUDGET',
                imageUrl: 'https://res.cloudinary.com/dtl7v76p4/image/upload/v1715150004/rupee.jpg',
                sortOrder: 2
            }
        ]);
        console.log('Food content seeded');

        console.log('Seeding completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Seeding error:', error);
        process.exit(1);
    }
}

seed();
