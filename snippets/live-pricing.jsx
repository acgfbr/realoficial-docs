export const LivePricing = ({ kind }) => {
  /*
   * Tabela de preço ao vivo da geração de imagem (kind="image") ou de vídeo
   * (kind="video"). Lê o endpoint público (sem login) e guarda a resposta no navegador
   * por 5 min, separado por tipo, o mesmo tempo do cache do servidor. Tudo fica dentro
   * do componente: no Mintlify a página só enxerga o que ela importa, e os hooks já vêm
   * injetados (sem pacotes externos).
   */
  const endpoint = kind === 'video' ? '/landing/video-pricing' : '/landing/image-pricing';
  const url = `https://api.realoficial.com.br/api/v1${endpoint}`;
  const storageKey = `realoficial-pricing:${kind}`;
  const ttl = 5 * 60 * 1000;
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
        if (saved && Date.now() - saved.at < ttl) return saved.data;
      } catch (error) {
        // Armazenamento bloqueado (aba anônima, cookies desligados): busca direto.
      }
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), data }));
      } catch (error) {
        // Sem armazenamento: a próxima visita busca de novo.
      }
      return data;
    };
    load()
      .then((data) => alive && setState({ status: 'ready', data }))
      .catch(() => alive && setState({ status: 'error', data: null }));
    return () => {
      alive = false;
    };
  }, [url, storageKey]);

  const formatDate = (iso) => {
    const date = new Date(iso || '');
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };
  const perSecond = (sheet, withAudio) => {
    const audio = sheet.audio_credits_per_second;
    return withAudio && audio != null && audio !== sheet.credits_per_second
      ? `${sheet.credits_per_second} (com áudio ${audio})`
      : `${sheet.credits_per_second}`;
  };

  if (state.status === 'loading') return <p>Carregando os preços atuais…</p>;
  if (state.status === 'error') {
    return (
      <p>
        Não foi possível carregar os preços agora. Consulte <code>GET {endpoint}</code> ou
        recarregue a página.
      </p>
    );
  }

  const data = state.data || {};
  const models = data.models || [];
  const footnote = (
    <p style={{ fontSize: '0.8rem', opacity: 0.75 }}>
      Preços ao vivo de <code>GET {endpoint}</code>
      {data.generated_at ? `, calculados em ${formatDate(data.generated_at)}` : ''}. A
      tabela pode ter até 5 minutos de atraso; o valor cobrado é sempre o do momento do
      pedido.
    </p>
  );

  if (kind === 'video') {
    if (data.available === false || models.length === 0) {
      return <p>A geração de vídeo está indisponível no momento.</p>;
    }
    return (
      <div>
        <table>
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Créditos por segundo</th>
              <th>Exemplo</th>
              <th>Outras resoluções</th>
              <th>Referências</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const shortest = (model.durations || [])[0];
              const others = (model.qualities || []).filter(
                (quality) => quality.height !== model.height
              );
              const reference = model.reference;
              return (
                <tr key={model.id}>
                  <td>
                    {model.label}
                    <br />
                    <code>{model.id}</code>
                  </td>
                  <td>
                    {perSecond(model, true)}
                    <br />
                    <span style={{ opacity: 0.7 }}>{model.height}p</span>
                  </td>
                  <td>
                    {shortest ? `${shortest} s = ${model.credits_per_second * shortest}` : '—'}
                  </td>
                  <td>
                    {others.map((quality) => (
                      <div key={quality.height}>
                        {quality.height}p: {perSecond(quality, false)}/s
                      </div>
                    ))}
                    {model.draft ? (
                      <div>
                        Rascunho {model.draft.height}p → final {model.draft.final.height}p:{' '}
                        {model.draft.final.credits_per_second}/s
                      </div>
                    ) : null}
                    {others.length === 0 && !model.draft ? '—' : null}
                  </td>
                  <td>
                    {reference ? (
                      <div>
                        Até {reference.images} imagens
                        {reference.videos > 0 ? ` e ${reference.videos} vídeos` : ''}
                        {reference.video_credits_per_second != null ? (
                          <div style={{ opacity: 0.7 }}>
                            Com vídeo: {reference.video_credits_per_second}/s sobre a
                            duração + o vídeo enviado
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {footnote}
      </div>
    );
  }

  const promotion = data.promotion;
  return (
    <div>
      {promotion ? (
        <p>
          <strong>Promoção ativa:</strong> {promotion.discount_percent}% de desconto
          {promotion.ends_at ? ` até ${formatDate(promotion.ends_at)}` : ''}. Os preços
          abaixo já vêm com o desconto.
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Modelo</th>
            <th>Créditos por imagem</th>
            <th>Modo econômico</th>
            <th>Imagem de referência</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id}>
              <td>
                {model.label}
                <br />
                <code>{model.id}</code>
                {model.id === data.default ? ' (padrão)' : ''}
              </td>
              <td>
                {model.credits_per_image}
                {model.regular_credits_per_image > model.credits_per_image ? (
                  <s style={{ opacity: 0.6 }}> {model.regular_credits_per_image}</s>
                ) : null}
              </td>
              <td>
                {model.economy_credits_per_image != null
                  ? `${model.economy_credits_per_image} (até 24 h)`
                  : '—'}
              </td>
              <td>
                {model.requires_reference_image
                  ? 'Obrigatória'
                  : model.accepts_reference_image === false
                    ? 'Não aceita'
                    : 'Opcional'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footnote}
    </div>
  );
};
