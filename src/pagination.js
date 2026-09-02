function lirePagination(requete, limiteDefaut = 50) {
  const pageDemandee = Number.parseInt(requete.query.page, 10);
  const limiteDemandee = Number.parseInt(requete.query.limite, 10);
  const page = Number.isFinite(pageDemandee) && pageDemandee > 0 ? pageDemandee : 1;
  const limite = Number.isFinite(limiteDemandee) && limiteDemandee > 0
    ? Math.min(limiteDemandee, 100)
    : limiteDefaut;
  return { page, limite, offset: (page - 1) * limite };
}

function reponsePaginee(lignes, page, limite) {
  const total = lignes.length ? Number(lignes[0].total_elements) : 0;
  const donnees = lignes.map(({ total_elements: totalIgnore, ...ligne }) => ligne);
  return {
    donnees,
    pagination: {
      page,
      limite,
      total,
      totalPages: Math.max(1, Math.ceil(total / limite)),
    },
  };
}

module.exports = { lirePagination, reponsePaginee };
