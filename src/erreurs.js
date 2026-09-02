// Traduit les erreurs PostgreSQL en messages compréhensibles côté client,
// sans jamais exposer de détail technique. Le détail complet part dans les logs.
function gererErreur(res, erreur, contexte) {
  console.error(`[${contexte || 'erreur'}]`, erreur);

  if (erreur.code === '23505') {
    return res.status(409).json({
      erreur: 'Cet enregistrement existe déjà (doublon détecté). Vérifiez le CIN, le code ou le nom saisi.',
    });
  }
  if (erreur.code === '23503') {
    return res.status(409).json({
      erreur: "Cette action fait référence à un élément inexistant ou déjà supprimé. Rechargez la page et réessayez.",
    });
  }
  if (erreur.code === '23514') {
    return res.status(400).json({
      erreur: 'Une des valeurs saisies ne respecte pas les règles attendues. Vérifiez le formulaire.',
    });
  }
  if (erreur.status) {
    return res.status(erreur.status).json({ erreur: erreur.message });
  }

  return res.status(500).json({
    erreur: 'Une erreur inattendue est survenue. Réessayez, et contactez le support si le problème persiste.',
  });
}

module.exports = { gererErreur };
