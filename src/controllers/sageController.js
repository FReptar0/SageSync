const { asyncHandler } = require('../middleware/errorHandler');
const config = require('../config/server');

const getSageStats = asyncHandler(async (req, res) => {
    const { sage } = req.app.locals;
    
    const stats = await sage.getInventoryStats();
    const locations = await sage.getUniqueLocations();
    
    res.json({
        ...stats,
        locations: locations.length,
        locationList: locations
    });
});

const getSageInventory = asyncHandler(async (req, res) => {
    const { sage } = req.app.locals;
    const { location } = req.params;
    const { limit = config.pagination.defaultLimit, offset = 0 } = req.query;
    
    // Validación de paginación
    const limitNum = parseInt(limit);
    const offsetNum = parseInt(offset);
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > config.pagination.maxLimit) {
        return res.status(400).json({ 
            error: `Parámetro limit debe estar entre 1 y ${config.pagination.maxLimit}` 
        });
    }
    
    if (isNaN(offsetNum) || offsetNum < 0) {
        return res.status(400).json({ 
            error: 'Parámetro offset debe ser un número mayor o igual a 0' 
        });
    }
    
    let items;
    if (location) {
        items = await sage.getInventoryItemsByLocation(location);
    } else {
        items = await sage.getAllInventoryItems();
    }
    
    // Paginación
    const startIndex = offsetNum;
    const paginatedItems = items.slice(startIndex, startIndex + limitNum);
    
    res.json({
        items: paginatedItems,
        total: items.length,
        offset: startIndex,
        limit: limitNum,
        hasMore: startIndex + limitNum < items.length,
        location: location || 'all'
    });
});

module.exports = {
    getSageStats,
    getSageInventory
};
