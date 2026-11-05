const { response } = require('express');
const Sucursal = require('../../models/Mantenimiento/Sucursal');

// ====== Exponer solo identidad de sedes activas a usuarios de programación ======
const listarSedesActivasProgramacion = async (_req, res = response) => {
  try {
    const sedes = await Sucursal.find({ estado: 'ACTIVA' })
      .select('_id codigo nombre nombreCorto esPrincipal')
      .sort({ esPrincipal: -1, nombre: 1 })
      .lean();
    return res.json({
      ok: true,
      sedes: sedes.map((sede) => ({
        _id: String(sede._id), codigo: sede.codigo, nombre: sede.nombre,
        nombreCorto: sede.nombreCorto || '', esPrincipal: sede.esPrincipal === true,
      })),
    });
  } catch (error) {
    console.error('Error consultando sedes activas de programación:', error);
    return res.status(500).json({ ok: false, msg: 'No se pudo consultar el catálogo de sedes.' });
  }
};

module.exports = { listarSedesActivasProgramacion };
