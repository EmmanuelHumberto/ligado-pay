# Preparação da integração com a LIGADO STORE

Atualizado em 07/11/2026. Código preparado e testado localmente; gateway em produção não alterado nesta rodada.

O gateway continua exclusivamente uma API de pagamentos, sem catálogo, frete, fiscal, regras de pedido ou consulta ao banco da Store. Recebe referência externa opaca e valor calculado pelo backend integrador.

`infinitepay.webhookApplicationIds` permite uma lista explícita de identidades autorizadas a consultar/reconciliar notificações. A notificação não escolhe a aplicação: o serviço identifica o pagamento persistido com a identidade autorizada correspondente. Pagamentos de aplicações fora da lista são ignorados; cada consulta/worker preserva aplicação, recebedor e conta operacional. `webhookApplicationId` singular continua compatível. Rotação de chaves da mesma aplicação não duplica workers.

`infinitepay.applicationRedirectUrls` mapeia aplicação autenticada para seu retorno HTTPS fixo. A intenção interna recebe applicationId do pagamento reservado; a API pública não aceita URL de retorno ou identificador de aplicação no corpo da cobrança. O retorno padrão atual continua válido para aplicações sem sobrescrita. A URL do webhook vigente é preservada e continua protegida pelo proxy HMAC; eventos não comprovam liquidação.

Foi preparado um novo token de serviço exclusivo da Store, ainda não cadastrado no gateway publicado. A proposta usa o recebedor conferido no Linux; não reutiliza o token do SystemOS nem copia a chave InfinitePay para a loja. Token e proposta ficam na pasta privada de integrações da Store, fora do Git. Publicação precisa preservar a configuração anterior, backups, credenciais vigentes e pagamentos existentes. Nenhuma cobrança real deve ser usada como sonda automática de implantação.

Validação: 38 unitários, 27 integrados e contrato aprovados. Há teste com duas aplicações habilitadas e uma terceira fora da lista, confirmação independente, ausência de acesso cruzado e retorno por configuração do servidor. Banco de teste exclusivo em loopback, parado após os testes. Nenhuma operação financeira real, migração ou publicação nesta rodada.

Permanecem pendentes: publicação coordenada, registro da identidade da Store, verificação do canal e homologação autorizada. Cartão, renovação após vencimento e fallback de retorno da Store continuam exigindo conclusão; não declarar o gateway comercialmente homologado para a loja por esses testes.
