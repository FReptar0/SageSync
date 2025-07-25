const { asyncHandler } = require('../middleware/errorHandler');

const getFracttalWarehouses = asyncHandler(async (req, res) => {
    const { fracttal } = req.app.locals;
    
    const warehouses = await fracttal.getWarehouses();
    res.json(warehouses);
});

module.exports = {
    getFracttalWarehouses
};
