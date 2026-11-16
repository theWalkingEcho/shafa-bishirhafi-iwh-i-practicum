require('dotenv').config();

const express = require('express');
const axios = require('axios');
const app = express();

app.set('view engine', 'pug');
app.use(express.static(__dirname + '/public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const api = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
        Authorization: `Bearer ${process.env.PRIVATE_ACCESS_KEY || ''}`,
        'Content-Type': 'application/json'
    }
});

const CONTACTS_TYPE = '0-1';
const COMPANIES_TYPE = '0-2';

const OBJECTS = {
    vehicles: {
        name: 'vehicles',
        singular: 'Vehicle',
        plural: 'Vehicles',
        description: 'Vehicles sold and serviced by the dealership.',
        uniqueProperty: 'vin',
        properties: [
            { name: 'name', label: 'Name' },
            { name: 'make', label: 'Make' },
            { name: 'model', label: 'Model' },
            { name: 'year', label: 'Year' },
            { name: 'vin', label: 'VIN' },
            { name: 'status', label: 'Status' }
        ],
        requiredProperties: ['name', 'vin'],
        searchableProperties: ['name', 'vin', 'make', 'model'],
        associatedObjects: [CONTACTS_TYPE, COMPANIES_TYPE]
    },
    inventory: {
        name: 'inventory',
        singular: 'Inventory Item',
        plural: 'Inventory',
        description: 'Parts and accessories held by the dealership.',
        uniqueProperty: 'sku',
        properties: [
            { name: 'name', label: 'Name' },
            { name: 'sku', label: 'SKU' },
            { name: 'category', label: 'Category' },
            { name: 'quantity', label: 'Quantity' },
            { name: 'location', label: 'Storage Location' }
        ],
        requiredProperties: ['name', 'sku'],
        searchableProperties: ['name', 'sku', 'category'],
        associatedObjects: [CONTACTS_TYPE, COMPANIES_TYPE]
    },
    warranties: {
        name: 'warranties',
        singular: 'Warranty',
        plural: 'Warranties',
        description: 'Coverage plans registered to dealership customers.',
        uniqueProperty: 'warranty_number',
        properties: [
            { name: 'name', label: 'Name' },
            { name: 'warranty_number', label: 'Warranty Number' },
            { name: 'coverage', label: 'Coverage' },
            { name: 'term', label: 'Term' },
            { name: 'status', label: 'Status' }
        ],
        requiredProperties: ['name', 'warranty_number'],
        searchableProperties: ['name', 'warranty_number', 'coverage'],
        associatedObjects: [CONTACTS_TYPE, COMPANIES_TYPE]
    }
};

const DEMO_CONTACTS = [
    { firstname: 'Maya', lastname: 'Brooks', email: 'maya.brooks@example.com' },
    { firstname: 'Ethan', lastname: 'Cole', email: 'ethan.cole@example.com' },
    { firstname: 'Ava', lastname: 'Reed', email: 'ava.reed@example.com' }
];

const DEMO_COMPANY = { name: 'VMob Auto Group - Demo' };

const DEMO_RECORDS = {
    vehicles: [
        { name: '2025 Aurora X5', make: 'Aurora', model: 'X5', year: '2025', vin: 'DEMO-NSTAR-001', status: 'In stock' },
        { name: '2024 Summit E2', make: 'Summit', model: 'E2', year: '2024', vin: 'DEMO-NSTAR-002', status: 'Reserved' },
        { name: '2025 Meridian S', make: 'Meridian', model: 'S', year: '2025', vin: 'DEMO-NSTAR-003', status: 'Sold' }
    ],
    inventory: [
        { name: 'All-weather floor mats', sku: 'NST-MAT-001', category: 'Accessory', quantity: '18', location: 'Warehouse A' },
        { name: 'EV charging cable', sku: 'NST-EVC-002', category: 'Accessory', quantity: '7', location: 'Showroom' },
        { name: 'Oil filter kit', sku: 'NST-OIL-003', category: 'Service part', quantity: '42', location: 'Warehouse B' }
    ],
    warranties: [
        { name: 'Aurora X5 protection plan', warranty_number: 'NST-WAR-001', coverage: 'Powertrain', term: '5 years', status: 'Active' },
        { name: 'Summit E2 battery plan', warranty_number: 'NST-WAR-002', coverage: 'Battery', term: '8 years', status: 'Active' },
        { name: 'Meridian S service plan', warranty_number: 'NST-WAR-003', coverage: 'Scheduled maintenance', term: '3 years', status: 'Active' }
    ]
};

function requireAccessToken() {
    if (!process.env.PRIVATE_ACCESS_KEY) {
        const error = new Error('HubSpot access token is not configured. Add PRIVATE_ACCESS_KEY to your local .env file.');
        error.status = 503;
        throw error;
    }
}

function getErrorMessage(error) {
    return error.response?.data?.message || error.message || 'An unexpected error occurred.';
}

function getErrorStatus(error) {
    return error.status || error.response?.status || 502;
}

function schemaProperties(config) {
    return config.properties.map((property) => ({
        ...property,
        type: 'string',
        fieldType: 'text'
    }));
}

async function getSchemas() {
    const response = await api.get('/crm-object-schemas/v3/schemas', { params: { limit: 100 } });
    return response.data.results || [];
}

async function ensureSchema(config, associatedObjects) {
    const schemas = await getSchemas();
    let schema = schemas.find((item) => item.name === config.name);

    if (!schema) {
        const response = await api.post('/crm-object-schemas/v3/schemas', {
            name: config.name,
            labels: { singular: config.singular, plural: config.plural },
            description: config.description,
            primaryDisplayProperty: 'name',
            secondaryDisplayProperties: config.properties
                .filter((property) => property.name !== 'name')
                .slice(0, 2)
                .map((property) => property.name),
            requiredProperties: config.requiredProperties,
            searchableProperties: config.searchableProperties,
            properties: schemaProperties(config),
            associatedObjects
        });
        return response.data;
    }

    const propertyResponse = await api.get(`/crm/v3/properties/${schema.objectTypeId}`);
    const currentPropertyNames = new Set((propertyResponse.data.results || []).map((property) => property.name));
    for (const property of schemaProperties(config)) {
        if (!currentPropertyNames.has(property.name)) {
            await api.post(`/crm/v3/properties/${schema.objectTypeId}`, property);
        }
    }

    const currentAssociations = schema.associatedObjects || [];
    const mergedAssociations = [...new Set([...currentAssociations, ...associatedObjects])];
    if (mergedAssociations.length !== currentAssociations.length) {
        const response = await api.patch(`/crm-object-schemas/v3/schemas/${schema.objectTypeId}`, {
            associatedObjects: mergedAssociations
        });
        schema = response.data;
    }
    return schema;
}

async function findRecord(objectType, propertyName, value, properties) {
    const response = await api.post(`/crm/v3/objects/${objectType}/search`, {
        filterGroups: [{
            filters: [{ propertyName, operator: 'EQ', value }]
        }],
        properties,
        limit: 1
    });
    return (response.data.results || [])[0] || null;
}

async function findOrCreateRecord(objectType, uniqueProperty, properties) {
    const existing = await findRecord(objectType, uniqueProperty, properties[uniqueProperty], Object.keys(properties));
    if (existing) return existing;
    const response = await api.post(`/crm/v3/objects/${objectType}`, { properties });
    return response.data;
}

async function associate(fromType, fromId, toType, toId) {
    await api.put(`/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`);
}

async function seedDemoRecords(schemas) {
    const company = await findOrCreateRecord('companies', 'name', DEMO_COMPANY);
    const contacts = [];

    for (const contact of DEMO_CONTACTS) {
        const record = await findOrCreateRecord('contacts', 'email', contact);
        await associate('contact', record.id, 'company', company.id);
        contacts.push(record);
    }

    const vehicles = [];
    for (let index = 0; index < DEMO_RECORDS.vehicles.length; index += 1) {
        const vehicle = await findOrCreateRecord(schemas.vehicles.objectTypeId, 'vin', DEMO_RECORDS.vehicles[index]);
        await associate(schemas.vehicles.objectTypeId, vehicle.id, 'contact', contacts[index].id);
        await associate(schemas.vehicles.objectTypeId, vehicle.id, 'company', company.id);
        vehicles.push(vehicle);
    }

    for (const key of ['inventory', 'warranties']) {
        for (let index = 0; index < DEMO_RECORDS[key].length; index += 1) {
            const config = OBJECTS[key];
            const record = await findOrCreateRecord(schemas[key].objectTypeId, config.uniqueProperty, DEMO_RECORDS[key][index]);
            await associate(schemas[key].objectTypeId, record.id, 'contact', contacts[index].id);
            await associate(schemas[key].objectTypeId, record.id, 'company', company.id);
            await associate(schemas[key].objectTypeId, record.id, schemas.vehicles.objectTypeId, vehicles[index].id);
        }
    }
}

async function getObjectRecords(objectTypeId, propertyNames) {
    const response = await api.get(`/crm/v3/objects/${objectTypeId}`, {
        params: {
            limit: 100,
            properties: propertyNames.join(',')
        }
    });
    return response.data.results || [];
}

async function getStandardObjectRecords(objectType, properties) {
    try {
        const response = await api.get(`/crm/v3/objects/${objectType}`, {
            params: { limit: 100, properties }
        });
        return { records: response.data.results || [], error: '' };
    } catch (error) {
        return { records: [], error: getErrorMessage(error) };
    }
}

async function getAssociations() {
    const [contactsResult, companiesResult, schemas] = await Promise.all([
        getStandardObjectRecords('contacts', 'firstname,lastname,email'),
        getStandardObjectRecords('companies', 'name'),
        getSchemas()
    ]);

    const vehiclesSchema = schemas.find((schema) => schema.name === 'vehicles');
    let vehicles = [];
    if (vehiclesSchema) {
        vehicles = await getObjectRecords(vehiclesSchema.objectTypeId, ['name', 'vin']);
    }

    return {
        contacts: contactsResult.records,
        companies: companiesResult.records,
        vehicles,
        associationErrors: {
            contacts: contactsResult.error,
            companies: companiesResult.error
        }
    };
}

async function dashboardData() {
    const schemas = await getSchemas();
    const objects = {};
    for (const [key, config] of Object.entries(OBJECTS)) {
        const schema = schemas.find((item) => item.name === config.name);
        objects[key] = {
            config,
            schema,
            records: schema ? await getObjectRecords(schema.objectTypeId, config.properties.map((property) => property.name)) : []
        };
    }
    const [contactsResult, companiesResult] = await Promise.all([
        getStandardObjectRecords('contacts', 'firstname,lastname,email'),
        getStandardObjectRecords('companies', 'name')
    ]);
    return {
        objects,
        contacts: contactsResult.records,
        companies: companiesResult.records,
        standardObjectErrors: {
            contacts: contactsResult.error,
            companies: companiesResult.error
        }
    };
}

app.get('/', async (req, res) => {
    try {
        requireAccessToken();
        const data = await dashboardData();
        res.render('index', {
            title: 'VMob Auto | HubSpot CRM',
            ...data,
            setupComplete: req.query.setup === 'complete',
            created: req.query.created || ''
        });
    } catch (error) {
        res.status(getErrorStatus(error)).render('index', {
            title: 'VMob Auto | HubSpot CRM',
            objects: {},
            contacts: [],
            companies: [],
            standardObjectErrors: { contacts: '', companies: '' },
            error: getErrorMessage(error),
            setupComplete: false,
            created: ''
        });
    }
});

app.post('/setup', async (req, res) => {
    try {
        requireAccessToken();
        const schemas = {};
        schemas.vehicles = await ensureSchema(OBJECTS.vehicles, OBJECTS.vehicles.associatedObjects);
        const vehicleTypeId = schemas.vehicles.objectTypeId;
        schemas.inventory = await ensureSchema(OBJECTS.inventory, [
            ...OBJECTS.inventory.associatedObjects,
            vehicleTypeId
        ]);
        schemas.warranties = await ensureSchema(OBJECTS.warranties, [
            ...OBJECTS.warranties.associatedObjects,
            vehicleTypeId
        ]);
        await seedDemoRecords(schemas);
        res.redirect('/?setup=complete');
    } catch (error) {
        res.status(getErrorStatus(error)).render('index', {
            title: 'VMob Auto | HubSpot CRM',
            objects: {},
            contacts: [],
            companies: [],
            error: getErrorMessage(error),
            setupComplete: false,
            created: ''
        });
    }
});

app.get('/update-cobj', (req, res) => {
    res.render('updates', {
        title: 'Update Custom Object Form | Integrating With HubSpot I Practicum',
        objectConfigs: OBJECTS,
        error: '',
        updated: req.query.updated || '',
        values: {}
    });
});

app.post('/update-cobj', async (req, res) => {
    const title = 'Update Custom Object Form | Integrating With HubSpot I Practicum';
    const selection = typeof req.body.property === 'string' ? req.body.property.split(':') : [];
    const [objectKey, propertyName, ...extra] = selection;
    const config = OBJECTS[objectKey];
    const recordId = String(req.body.recordId || '').trim();
    const value = String(req.body.value || '').trim();

    if (!config || !Array.isArray(config.properties) || extra.length > 0 ||
        !config.properties.some((property) => property.name === propertyName)) {
        return res.status(400).render('updates', {
            title,
            objectConfigs: OBJECTS,
            error: 'Choose a valid custom object property.',
            updated: '',
            values: { property: req.body.property, recordId, value }
        });
    }

    if (!/^\d+$/.test(recordId) || !value) {
        return res.status(400).render('updates', {
            title,
            objectConfigs: OBJECTS,
            error: 'Enter a valid HubSpot record ID and a new property value.',
            updated: '',
            values: { property: req.body.property, recordId, value }
        });
    }

    try {
        requireAccessToken();
        const schema = (await getSchemas()).find((item) => item.name === config.name);
        if (!schema) {
            return res.status(409).render('updates', {
                title,
                objectConfigs: OBJECTS,
                error: `Set up the ${config.plural.toLowerCase()} custom object before updating records.`,
                updated: '',
                values: { property: req.body.property, recordId, value }
            });
        }

        await api.patch(`/crm/v3/objects/${schema.objectTypeId}/${recordId}`, {
            properties: { [propertyName]: value }
        });
        return res.redirect(`/update-cobj?updated=${encodeURIComponent(config.singular)}`);
    } catch (error) {
        return res.status(getErrorStatus(error)).render('updates', {
            title,
            objectConfigs: OBJECTS,
            error: getErrorMessage(error),
            updated: '',
            values: { property: req.body.property, recordId, value }
        });
    }
});

app.get('/records/:objectKey/new', async (req, res) => {
    const config = OBJECTS[req.params.objectKey];
    if (!config) return res.status(404).send('Unknown custom object.');

    try {
        requireAccessToken();
        const options = await getAssociations();
        res.render('record-form', {
            title: `Add ${config.singular} | VMob Auto`,
            objectKey: req.params.objectKey,
            config,
            ...options,
            error: ''
        });
    } catch (error) {
        res.status(getErrorStatus(error)).render('record-form', {
            title: `Add ${config.singular} | VMob Auto`,
            objectKey: req.params.objectKey,
            config,
            contacts: [],
            companies: [],
            vehicles: [],
            error: getErrorMessage(error)
        });
    }
});

async function createCustomObjectRecord(req, res, objectKey) {
    const config = OBJECTS[objectKey];
    if (!config || !Array.isArray(config.properties)) return res.status(404).send('Unknown custom object.');

    const properties = Object.fromEntries(
        config.properties.map((property) => [property.name, String(req.body[property.name] || '').trim()])
    );
    if (config.requiredProperties.some((property) => !properties[property])) {
        return res.status(400).send('Please provide all required fields.');
    }

    try {
        requireAccessToken();
        const schema = (await getSchemas()).find((item) => item.name === config.name);
        if (!schema) {
            return res.status(409).send('Create the automobile custom objects before adding records.');
        }

        const associationOptions = await getAssociations();
        const contact = associationOptions.contacts.find((record) => record.id === req.body.contactId);
        if (!contact) return res.status(400).send('Choose a valid contact to associate with this record.');
        const company = associationOptions.companies.find((record) => record.id === req.body.companyId);
        const vehicle = associationOptions.vehicles.find((record) => record.id === req.body.vehicleId);
        const response = await api.post(`/crm/v3/objects/${schema.objectTypeId}`, { properties });
        await associate(schema.objectTypeId, response.data.id, 'contact', contact.id);
        if (company) await associate(schema.objectTypeId, response.data.id, 'company', company.id);
        if (vehicle && objectKey !== 'vehicles') {
            const vehiclesSchema = (await getSchemas()).find((item) => item.name === 'vehicles');
            await associate(schema.objectTypeId, response.data.id, vehiclesSchema.objectTypeId, vehicle.id);
        }
        return res.redirect(`/?created=${encodeURIComponent(config.singular)}`);
    } catch (error) {
        try {
            const options = await getAssociations();
            return res.status(getErrorStatus(error)).render('record-form', {
                title: `Add ${config.singular} | VMob Auto`,
                objectKey,
                config,
                ...options,
                error: getErrorMessage(error),
                values: properties
            });
        } catch (renderError) {
            return res.status(getErrorStatus(renderError)).send(getErrorMessage(renderError));
        }
    }
}

app.post('/create-cobj', async (req, res) => {
    const objectKey = typeof req.body.objectKey === 'string' ? req.body.objectKey : '';
    return createCustomObjectRecord(req, res, objectKey);
});

app.post('/records/:objectKey', async (req, res) => createCustomObjectRecord(req, res, req.params.objectKey));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
