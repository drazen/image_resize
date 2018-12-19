// On create object s3 trigger handler

const async = require('async');
const AWS = require('aws-sdk');
const gm = require('gm').subClass({ imageMagick: true });
const s3 = new AWS.S3();

// Define the semantic image size names and their current dimensions.
// Use the key names to form part of the S3 object key and thus the image URL:
//  'sm' => .../images/sm-logo.png
// TODO: Change/add key names and resolutions to taste
const SIZES = {'sm': '200x150', 'md': '400x300', 'lg': '600x450'};

exports.resizeImage = (event, context) => {
    console.log(event.Records)
    const srcBucket = event.Records[0].s3.bucket.name;
    const srcKey    =  event.Records[0].s3.object.key.replace(/\+/g, " "); // undo white space replacement

    // Download the image from S3
    s3.getObject({ Bucket: srcBucket, Key: srcKey }, (err, response) => {
        if (err){
            console.error('Cannot download image: ' + srcKey + " : " + err);
            context.done();
        }

        // Check the content type to ensure this is an image.  
        // NOTE: content-type needs to be set when uploading the original.  Don't just upload as 'application/octet-stream'!
        const [mediaType, format] = response.ContentType.toLowerCase().split('/');
        if ((mediaType != 'image') || !(['jpeg', 'png'].includes(format))) {
            console.log('Unsupported content-type: ' + response.ContentType + ' for ' + srcKey);
            context.done();  
        }
        // Get the image data and metadata to process
        let filename = srcKey.split("/").pop();
        let image = gm(response.Body);

        // resize image for for each of the specified sizes
        async.each(SIZES, (size,  callback) => {
            let resizedObjKey = `images/${Object.entries(SIZES).find(i => i[1] === size)[0]}-${filename}`;  // Must be a clearer way to get the key name!
            let [width, height] = size.split('x');
            resize(image, format, width, height, resizedObjKey, callback);
        },
        (err) => {
            if (err) {
                console.error('Cannot resize ' + srcKey + 'error: ' + err);
            }
            context.done();
        });
    });
};

const resize = (image, format, width, height, dstKey) => {
    async.waterfall([
        function transform(next) {
            // Transform the image buffer in memory
            image.interlace("Plane")
                .quality(80)
                .resize(width, height, '^')  // ^ is Imagemagick "fill area" http://www.imagemagick.org/Usage/resize/#fill
                .gravity('Center')
                .crop(width, height)
                .toBuffer(format, function(err, buffer) {
                if (err) {
                    next(err);
                } else {
                    next(null, buffer);
                }
            });
        },
        function upload(data, next) {
            console.log("Uploading data to " + dstKey);
            s3.putObject({
                    Bucket: process.env.ASSET_BUCKET,
                    Key: dstKey,
                    Body: data,
                    ContentType: `image/${format}`,
                    ACL: 'public-read'
                },
                next);
            }
        ], (err) => {
            if (err) { console.error(err); }
        }
    );
};