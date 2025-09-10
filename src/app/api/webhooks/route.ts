import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3"

const awsRegion = process.env.TIGRIS_REGION || 'us-east-1'
const s3 = new S3Client({ region: awsRegion })

export async function POST(req: NextRequest) {
  try {
    const evt = await verifyWebhook(req)

    if (evt.type === 'user.created') {
        const userId: string = evt.data.id
        if (!userId) {
          console.warn('Clerk webhook missing user id on user.created')
        } else {
          const bucketName = "test"
          try {
            const createParams = { Bucket: bucketName }
            await s3.send(new CreateBucketCommand(createParams))
            console.log(`Created S3 bucket: ${bucketName}`)
          } catch (error) {
            console.error('Failed to create S3 bucket for user:', userId, error)
          }
        }
    }

    return new Response('Webhook received', { status: 200 })
  } catch (err) {
    console.error('Error verifying webhook:', err)
    return new Response('Error verifying webhook', { status: 400 })
  }
}